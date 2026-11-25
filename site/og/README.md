# OG card source

`og.html` renders `site/public/og.jpg` (1200x630). It reads frames cut from the hero clips (`rec-0.2.jpg` = hero/record.mp4 at 0.2 s, `inset.jpg` = record.mp4 at 1.7 s cropped 880x495+360+20), which are not in the repo. Render at 2x with Playwright, then downscale to 1200x630.
