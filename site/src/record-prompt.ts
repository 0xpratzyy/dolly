import {buildPrompt} from './prompt';
import {BASE, DEFAULT_LINES, PLAN} from './data';

/** The Record tab's default prompt: the editor's prompt for the untouched demo. Its own chunk, so the landing page only fetches it when idle. */
export default buildPrompt(BASE, DEFAULT_LINES, PLAN.zooms);
