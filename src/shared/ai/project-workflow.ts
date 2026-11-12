import { IMAGE_ITEM_WORKFLOW } from '../image-import/workflow-instructions.js'

/** Product-owned defaults for creation tasks, independent of model, scene files and task history. */
export const PROJECT_CREATION_WORKFLOW = Object.freeze({
  id: 'sceneweave-project-creation', version: 1,
  instructions: [
    '这是Sceneweave项目默认制作规范，适用于地图生成、局部编辑、素材和图片item任务。规范由项目提供；场景工程和制作工作包只承载成果或任务进度，不是规范本体。',
    '先明确用户目标、交付对象、处理范围和当前基线。确认单位、实际或暂定比例、图层/Floor、物件占地与支撑；缺失实际尺寸可以明确暂定，不把猜测写成实测。新建、修改现有场景和制作素材分别选择相应入口。',
    '先核对当前实际提供的工具、授权范围和视觉能力，再选择已有生成器、有限编辑或图片制作步骤。规范不授予新权限；没有相应工具时解释可执行的页面步骤和缺项，不伪称已读取图片、执行切割或采用修改。',
    '按目标建立小步候选，保留输入、原件、参数与失败。使用稳定身份和当前代次，不让旧候选覆盖新修改。物理几何、编辑锁、许可、支撑、秘密与玩家过滤由实际校验器检查，外观改善不能暗改这些语义。',
    '技术校验与视觉审核分别完成。检查实际范围、资源、支撑和依赖；具备图片输入时对照原尺寸与局部放大，检查边缘、遮挡、纹理和移转露底。没有实际图像则标为未进行视觉审核；生成成功或像素变化数不是质量分。',
    '候选通过必要检查后，按宿主现有保护、基线/CAS、一次采用与撤销链提交；不绕过用户当前授权。保存或采用失败保留当前成果。未知计费请求只查询已有请求身份，不自动重发。',
    '按用户需要交付普通工程、个人素材或制作工作包；实际冷读并继续编辑，核对所需资源和确切内容。交付时分别说明已实现、已验证、未通过和未测，留下当前对象、最后有效断点、下一操作及跨电脑需单独携带的资料。',
  ].join('\n'),
})

/** Injected into new built-in conversation and authoring tasks; it adds guidance, never tools. */
export const DEFAULT_PROJECT_WORKFLOW_INSTRUCTIONS = [
  `Project creation workflow: ${PROJECT_CREATION_WORKFLOW.id}@${PROJECT_CREATION_WORKFLOW.version}`,
  PROJECT_CREATION_WORKFLOW.instructions,
  `Image-item task procedure: ${IMAGE_ITEM_WORKFLOW.id}@${IMAGE_ITEM_WORKFLOW.version}`,
  '以下图片步骤在当前宿主实际开放image_import_*工具时执行；当前工具目录没有它们时，用这些步骤指导页面制作或交接给项目图片工具，明确尚未执行。图片步骤仅在相关任务使用，不要求无关地图编辑执行切割。',
  IMAGE_ITEM_WORKFLOW.instructions,
].join('\n\n')
