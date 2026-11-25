/** Constants the landing page needs without pulling in the editor's data (plan.json, Subtle's styles, the studio types). */

/** The repo is public: every GitHub link on the site reads this one constant. */
export const REPO_URL = 'https://github.com/0xpratzyy/dolly';
export const SUBTLE_URL = 'https://github.com/0xpratzyy/subtle';
/** Clone into Claude Code's skills folder, then setup.sh (checks Node and ffmpeg, installs the studio and Autopilot,
 *  builds the Mac recorder). Shown as two lines; copied and pasted as one command. */
export const INSTALL_LINES = [`git clone ${REPO_URL} ~/.claude/skills/dolly`, '~/.claude/skills/dolly/setup.sh'];
export const INSTALL = INSTALL_LINES.join(' && ');
