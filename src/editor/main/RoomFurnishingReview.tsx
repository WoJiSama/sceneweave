import type { RoomFurnishingReview as Review } from '../../shared/furnishing/contracts'

export default function RoomFurnishingReview({ review }: { review: Review }) {
  return <div className="furnishing-review" aria-label="用途布置结果">
    <p role="status">{review.hasCandidate ? review.summary : `没有需要修改的内容。${review.summary}`}</p>
    <p>{review.hasCandidate ? '请查看画布中的候选，确认后采用；取消预览后可继续调整下面的设置。' : '现有内容与删除记录已保留；可修改功能数量或明确允许移动，再预览。'}</p>
    {review.rooms && review.rooms.length > 1 && <div aria-label="逐房布置结果">{review.rooms.map(room => <details key={room.roomId}><summary>{room.purpose} · {room.style} · 新增{room.added}件、移动{room.moved}件、保留{room.preserved}件</summary><RoomFurnishingReview review={room}/></details>)}</div>}
    {!!review.missing.length && <div role="note"><strong>以下功能尚未填入</strong><ul>{review.missing.map((name, index) => <li key={index}>{name}</li>)}</ul><p>可减少数量、选择占地更小的家具，或明确允许移动已有家具后再预览。家具不会自动缩小。</p></div>}
    <p>结构通路（1米）：{review.routes.total ? `${review.routes.clear}/${review.routes.total}条已证明` : '当前没有可检查的结构路线'}；家具取用（0.6米）：{review.furnitureAccess.total ? `${review.furnitureAccess.clear}/${review.furnitureAccess.total}件已证明` : '当前没有取用路线结果'}。</p>
    {(review.routes.clear < review.routes.total || review.furnitureAccess.clear < review.furnitureAccess.total) && <p>未证明的通路请继续检查门的位置、门状态和家具占地；保留的人工内容不会强行移动。</p>}
    {!!review.notes.length && <details><summary>查看布置依据与保留原因</summary><ul>{review.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
  </div>
}
