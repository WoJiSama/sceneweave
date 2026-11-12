"""Offline CPU mask proposals for one explicitly supplied PNG and pinned SlimSAM.

No downloads, image writes, RGB output, automatic candidate selection or adoption.
The caller supplies a local model directory and installed Python dependencies.
"""

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import stat
import sys
import time

PROTOCOL = "sceneweave-local-segmentation/1"
MODEL_ID = "Xenova/slimsam-77-uniform"
MODEL_REVISION = "5850ab45f587c112167512ffef949107115e26a0"
MODEL_FILES = (
    ("vision_encoder.onnx", 23276014, "9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0"),
    ("prompt_encoder_mask_decoder.onnx", 16557892, "f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb"),
)
MAX_INPUT_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SOURCE_PIXELS = 32_000_000
MAX_CONTEXT_PIXELS = 32_000_000
MAX_TARGET_PIXELS = 250_000
MAX_RUN_ENTRIES = 200_000


class LocalError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, message, code="invalid-request"):
    if not condition:
        raise LocalError(code, message)


def strict_keys(value, required, optional=()):
    require(type(value) is dict and set(required) <= value.keys()
            and value.keys() <= set(required) | set(optional), "Unexpected or missing JSON fields")


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def bounds(value):
    strict_keys(value, ("x", "y", "width", "height"))
    require(all(integer(value[key], 0, 8191) for key in ("x", "y"))
            and all(integer(value[key], 1, 8192) for key in ("width", "height")), "Invalid pixel bounds")
    require(value["x"] + value["width"] <= 8192 and value["y"] + value["height"] <= 8192,
            "Pixel bounds exceed supported image dimensions")
    return dict(value)


def contains(outer, inner):
    return (outer["x"] <= inner["x"] and outer["y"] <= inner["y"]
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"]
            and inner["y"] + inner["height"] <= outer["y"] + outer["height"])


def point_in(point, area):
    return (area["x"] <= point["x"] < area["x"] + area["width"]
            and area["y"] <= point["y"] < area["y"] + area["height"])


def validate_request(value):
    strict_keys(value, ("protocol", "imagePath", "contextBounds", "targetBounds", "points"), ("postprocess",))
    require(value["protocol"] == PROTOCOL, "Unsupported local segmentation protocol")
    require(type(value["imagePath"]) is str and 0 < len(value["imagePath"]) <= 4096
            and "\0" not in value["imagePath"] and Path(value["imagePath"]).is_absolute(),
            "imagePath must be an explicit absolute local PNG path")
    context = bounds(value["contextBounds"])
    target = bounds(value["targetBounds"])
    require(context["width"] * context["height"] <= MAX_CONTEXT_PIXELS, "Context exceeds 32 million pixels")
    require(target["width"] * target["height"] <= MAX_TARGET_PIXELS, "Target exceeds 250000 pixels")
    require(contains(context, target), "Target must be entirely inside context")
    require(type(value["points"]) is list and 1 <= len(value["points"]) <= 32, "Expected 1 to 32 points")
    points = []
    for point in value["points"]:
        strict_keys(point, ("x", "y", "label"))
        require(all(type(point[key]) in (int, float) and math.isfinite(point[key]) for key in ("x", "y"))
                and integer(point["label"], 0, 1), "Invalid point coordinates or label")
        require(point_in(point, context), "Every point must be inside context")
        require(point["label"] != 1 or point_in(point, target), "Positive points must be inside target")
        points.append(dict(point))
    require(any(point["label"] == 1 for point in points), "At least one positive point is required")
    cleanup = value.get("postprocess", {"fillHolesMaxPixels": 0, "removeIslandsMaxPixels": 0})
    strict_keys(cleanup, ("fillHolesMaxPixels", "removeIslandsMaxPixels"))
    require(all(integer(number, 0, 4) for number in cleanup.values()), "Postprocess limits must be integers from 0 to 4")
    return {"protocol": PROTOCOL, "imagePath": value["imagePath"], "contextBounds": context,
            "targetBounds": target, "points": points, "postprocess": dict(cleanup)}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON field")
        result[key] = value
    return result


def read_request():
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    require(0 < len(raw) <= MAX_INPUT_BYTES, "JSON input exceeds 64 KiB or is empty")
    try:
        return validate_request(json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON"))))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise LocalError("invalid-request", "Expected one strict UTF-8 JSON request") from error


def capture_file(path, maximum):
    try:
        with open(path, "rb") as handle:
            before = os.fstat(handle.fileno())
            require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= maximum,
                    "Expected a nonempty bounded regular file", "file-budget")
            data = handle.read(before.st_size + 1)
            after = os.fstat(handle.fileno())
            require(len(data) == before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns,
                    "File changed during capture", "file-changed")
            return data
    except OSError as error:
        raise LocalError("file-unavailable", "An explicit image/model file could not be read") from error


def check_interface(session, inputs, outputs):
    for actual, expected in ((session.get_inputs(), inputs), (session.get_outputs(), outputs)):
        require(len(actual) == len(expected), "Unexpected model interface", "model-interface")
        for node, (name, dtype, dimensions) in zip(actual, expected):
            require(node.name == name and node.type == dtype and len(node.shape) == len(dimensions)
                    and all(wanted is None or actual == wanted for actual, wanted in zip(node.shape, dimensions)),
                    "Unexpected model tensor signature", "model-interface")
    require(session.get_providers() == ["CPUExecutionProvider"], "Only CPU inference is supported", "model-interface")


def resize_bilinear(np, value, height, width):
    """Half-pixel interpolation, align_corners=False, without antialiasing logits."""
    old_height, old_width = value.shape
    ys = np.clip((np.arange(height) + .5) * old_height / height - .5, 0, old_height - 1)
    xs = np.clip((np.arange(width) + .5) * old_width / width - .5, 0, old_width - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, old_height - 1), np.minimum(x0 + 1, old_width - 1)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    return ((value[y0[:, None], x0[None, :]] * (1 - fx) + value[y0[:, None], x1[None, :]] * fx) * (1 - fy)
            + (value[y1[:, None], x0[None, :]] * (1 - fx) + value[y1[:, None], x1[None, :]] * fx) * fy)


def target_logits(np, low_resolution, resized, context, target):
    """Sample only target pixels, equivalent to resizing the complete context.

    Avoid allocating a 32 MP float64 context for each of three candidates.
    """
    padded = resize_bilinear(np, low_resolution, 1024, 1024)[:resized[1], :resized[0]]
    dx, dy = target["x"] - context["x"], target["y"] - context["y"]
    xs = np.clip((np.arange(dx, dx + target["width"]) + .5) * resized[0] / context["width"] - .5, 0, resized[0] - 1)
    ys = np.clip((np.arange(dy, dy + target["height"]) + .5) * resized[1] / context["height"] - .5, 0, resized[1] - 1)
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    x1, y1 = np.minimum(x0 + 1, resized[0] - 1), np.minimum(y0 + 1, resized[1] - 1)
    fx, fy = (xs - x0)[None, :], (ys - y0)[:, None]
    return ((padded[y0[:, None], x0[None, :]] * (1 - fx) + padded[y0[:, None], x1[None, :]] * fx) * (1 - fy)
            + (padded[y1[:, None], x0[None, :]] * (1 - fx) + padded[y1[:, None], x1[None, :]] * fx) * fy)


def components(mask, selected):
    height, width = mask.shape
    visited = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or bool(mask[y, x]) != selected:
                continue
            visited[index] = 1
            queue, count, small, border = [(y, x)], 0, [], False
            while queue:
                cy, cx = queue.pop()
                count += 1
                if count <= 4:
                    small.append((cy, cx))
                border |= cy == 0 or cx == 0 or cy == height - 1 or cx == width - 1
                for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width:
                        index = ny * width + nx
                        if not visited[index] and bool(mask[ny, nx]) == selected:
                            visited[index] = 1
                            queue.append((ny, nx))
            yield count, small, border


def cleanup_mask(mask, request):
    cleanup, target = request["postprocess"], request["targetBounds"]
    result = mask.copy()
    filled, removed = 0, 0
    if cleanup["fillHolesMaxPixels"]:
        for count, points, border in components(mask, False):
            if not border and count <= cleanup["fillHolesMaxPixels"]:
                for y, x in points:
                    result[y, x] = True
                filled += count
    if cleanup["removeIslandsMaxPixels"]:
        # A seed protects the source pixel containing it, including fractional seeds.
        positive = {(math.floor(point["y"]) - target["y"], math.floor(point["x"]) - target["x"])
                    for point in request["points"] if point["label"] == 1}
        for count, points, _ in components(result, True):
            if count <= cleanup["removeIslandsMaxPixels"] and not any(point in positive for point in points):
                for y, x in points:
                    result[y, x] = False
                removed += count
    return result, {"filledPixels": filled, "removedPixels": removed}


def encode_mask(np, value, target):
    flat = value.ravel().astype(np.uint8) * 255
    changes = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    starts = np.concatenate(([0], changes))
    counts = np.diff(np.concatenate((starts, [flat.size])))
    require(len(starts) * 2 <= MAX_RUN_ENTRIES, "Mask exceeds 100000 RLE segments; narrow the target", "mask-complexity")
    runs = []
    for count, start in zip(counts, starts):
        runs.extend((int(count), int(flat[start])))
    return {**target, "runs": runs}


def infer(request, model_dir, threads):
    started = time.perf_counter()
    # Capture exact allowed bytes before importing/runtime execution; ORT receives
    # these bytes, never a mutable filename that can change after the digest.
    model_bytes = []
    for name, size, digest in MODEL_FILES:
        data = capture_file(model_dir / name, size)
        require(len(data) == size and hashlib.sha256(data).hexdigest() == digest,
                "Model bytes do not match the pinned FP32 SlimSAM whitelist", "model-hash")
        model_bytes.append(data)
    captured = capture_file(request["imagePath"], MAX_SOURCE_BYTES)
    require(captured.startswith(b"\x89PNG\r\n\x1a\n"), "Only a normalized source PNG is accepted", "image-format")
    try:
        import numpy as np
        from PIL import Image
        import onnxruntime as ort
    except ImportError as error:
        raise LocalError("dependency-unavailable", "Install numpy, Pillow and onnxruntime in the explicitly configured local Python environment") from error
    Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
    try:
        with Image.open(io.BytesIO(captured)) as opened:
            require(opened.format == "PNG" and getattr(opened, "n_frames", 1) == 1, "Expected one non-animated PNG", "image-format")
            width, height = opened.size
            require(1 <= width <= 8192 and 1 <= height <= 8192 and width * height <= MAX_SOURCE_PIXELS,
                    "Source exceeds supported pixel dimensions", "image-budget")
            image_bounds = {"x": 0, "y": 0, "width": width, "height": height}
            require(contains(image_bounds, request["contextBounds"]) and contains(image_bounds, request["targetBounds"]),
                    "Context/target exceeds the actual source PNG")
            image = opened.convert("RGB")
    except LocalError:
        raise
    except Exception as error:
        raise LocalError("image-format", "Source PNG could not be completely decoded") from error
    context, target = request["contextBounds"], request["targetBounds"]
    crop = image.crop((context["x"], context["y"], context["x"] + context["width"], context["y"] + context["height"]))
    longest = max(crop.size)
    new_width, new_height = (max(1, int(number * 1024 / longest + .5)) for number in crop.size)
    pixels = np.asarray(crop.resize((new_width, new_height), Image.Resampling.BILINEAR), dtype=np.float32) / 255.
    pixels = (pixels - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    padded = np.zeros((1, 3, 1024, 1024), np.float32)
    padded[0, :, :new_height, :new_width] = pixels.transpose(2, 0, 1)
    options = ort.SessionOptions()
    options.intra_op_num_threads, options.inter_op_num_threads = threads, 1
    options.log_severity_level = 3
    before_load = time.perf_counter()
    encoder = ort.InferenceSession(model_bytes[0], sess_options=options, providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(model_bytes[1], sess_options=options, providers=["CPUExecutionProvider"])
    embeddings = [("image_embeddings", "tensor(float)", (None, 256, 64, 64)),
                  ("image_positional_embeddings", "tensor(float)", (None, 256, 64, 64))]
    check_interface(encoder, [("pixel_values", "tensor(float)", (None, 3, 1024, 1024))], embeddings)
    check_interface(decoder, [("input_points", "tensor(float)", (None, None, None, 2)),
                              ("input_labels", "tensor(int64)", (None, None, None))] + embeddings,
                    [("iou_scores", "tensor(float)", (None, None, 3)),
                     ("pred_masks", "tensor(float)", (None, None, 3, 256, 256))])
    load_seconds = time.perf_counter() - before_load
    before_encode = time.perf_counter()
    embedding, positional = encoder.run(None, {"pixel_values": padded})
    encode_seconds = time.perf_counter() - before_encode
    points = np.array([[[[(point["x"] - context["x"]) * new_width / context["width"],
                          (point["y"] - context["y"]) * new_height / context["height"]]
                         for point in request["points"]]]], np.float32)
    labels = np.array([[[point["label"] for point in request["points"]]]], np.int64)
    before_decode = time.perf_counter()
    scores, masks = decoder.run(None, {"input_points": points, "input_labels": labels,
                                      "image_embeddings": embedding, "image_positional_embeddings": positional})
    decode_seconds = time.perf_counter() - before_decode
    require(scores.shape == (1, 1, 3) and masks.shape == (1, 1, 3, 256, 256)
            and np.isfinite(scores).all() and np.isfinite(masks).all(), "Invalid model result", "inference-result")
    candidates = []
    for index in range(3):
        mask = target_logits(np, masks[0, 0, index], (new_width, new_height), context, target) > 0
        mask, changed = cleanup_mask(mask, request)
        candidates.append({"index": index, "score": float(scores[0, 0, index]), "mask": encode_mask(np, mask, target),
                           "foregroundPixels": int(mask.sum()), "postprocess": changed})
    return {"protocol": PROTOCOL,
            "model": {"id": MODEL_ID, "revision": MODEL_REVISION,
                      "files": [{"name": name, "sha256": digest} for name, _, digest in MODEL_FILES]},
            "source": {"sha256": hashlib.sha256(captured).hexdigest(), "width": width, "height": height},
            "parameters": {"contextBounds": context, "targetBounds": target, "points": request["points"],
                           "postprocess": request["postprocess"], "threshold": 0, "resizedSize": {"width": new_width, "height": new_height},
                           "provider": "CPUExecutionProvider", "threads": threads, "maskEncoding": "row-major-count-alpha-rle",
                           "alphaMode": "binary", "boxPrompt": False},
            "candidates": candidates,
            "timing": {"loadSeconds": load_seconds, "encodeSeconds": encode_seconds,
                       "decodeSeconds": decode_seconds, "totalSeconds": time.perf_counter() - started}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    try:
        require(Path(args.model_dir).is_absolute() and integer(args.threads, 1, 4), "Expected explicit absolute model directory and 1..4 CPU threads")
        result = infer(read_request(), Path(args.model_dir), args.threads)
        output = json.dumps(result, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
        require(len(output.encode("utf-8")) <= MAX_OUTPUT_BYTES, "Result exceeds 8 MiB", "output-budget")
        sys.stdout.write(output + "\n")
    except Exception as error:
        code = error.code if isinstance(error, LocalError) else "local-inference-failed"
        message = str(error) if isinstance(error, LocalError) else "Local CPU inference failed; check the explicitly configured dependencies and model files"
        sys.stdout.write(json.dumps({"protocol": PROTOCOL, "error": {"code": code, "message": message}}, separators=(",", ":")) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
