/** A storyboard is always exactly this many scenes. The server, the prompts and the UI all read it from here. */
export const SCENE_COUNT = 4;
/** Scene indexes in order: 0 to SCENE_COUNT - 1. */
export const SCENE_INDEXES: readonly number[] = Array.from({ length: SCENE_COUNT }, (_, index) => index);
