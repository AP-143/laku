/**
 * The most scenes a storyboard can have. The planner decides how many the ad needs; this only stops an answer so long
 * that the picture would be a wall of tiny panels. The planner and the retry of a picture are held to the same limit.
 */
export const MAX_SCENES = 20;

/** The most characters of the art direction a request may carry. */
export const MAX_ART_DIRECTION_CHARS = 1200;
