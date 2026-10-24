# Fixed builtin content provider

`builtin-data.json` is an immutable complete-v1 content snapshot, not a saved user scene or a validity certificate. It contains the existing definitions, fixed appearance templates, resource metadata, exact license texts and paths to the existing 57 PNG files. It adds no copied image files and changes no existing definition, source asset or curation record.

The snapshot was extracted from the existing outdoor blank catalog plus themed extension. Incidental provider scene, lineage and timestamps use fixed neutral values. Runtime imports only this JSON, curation JSON and shared pure modules; it never imports editor factories or legacy IO. Every load validates actual image bytes and pixels through the supplied image port, then checks all 62 algorithm-1 keys and six exact refinement references. The comparison test reconstructs the old provider independently and compares all item metadata and fixed content.
