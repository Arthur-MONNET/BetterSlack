# GitLab

Your open GitLab merge requests by project, with the stages and jobs of each pipeline, in a view of Slack's rail and as a small pipeline summary in Slack's top bar.

- **A view in the rail** lists every open merge request you wrote, in every group and project your account can see, grouped by **project** — the one with the most recently touched merge request first, and the same inside each project. Each row has its title, its number, its branches, when it last changed, and its pipeline as a row of **stages** (✓ passed, ✕ failed, ◜ running, ○ waiting, ▶ manual, ⊘ canceled, » skipped) with how far it is.
- **Projects fold.** Click a project's band (or its caret) to fold it and again to open it, or use **Collapse all**; the choice is kept, and a folded project still says how many of its pipelines failed and how many are running. A merge request is on one line when the view is wide, two when it is medium and stacked when it is narrow.
- **A click on a stage** opens its jobs, each with its status and how long it took, each a link to its page on GitLab. Titles, numbers, projects and pipelines link to GitLab too.
- **The top bar**, at the far left, keeps the pipeline that is going — or, with none going, the last one that finished — in view while you are in a channel: *⑂ Vision !1658 feature/nav-cleanup build 2/4 ✓ ◜ ○*. The icon is a merge request tinted by how its pipeline is going (green, red, blue, grey). As the room shrinks it gives up the merge request's branch first, then the stage's name, the row of stages, the project and the merge request, and keeps the icon last. When something failed, what failed is kept longer than the project.
- **A click on the bar** (a caret says it opens) lists the newest pipeline of each of the three branches most recently worked on — one per branch, so a branch pushed to three times is one entry — each with its merge request's title and branch, its state, its stages — a click on one opens its jobs — and buttons that open the merge request and the pipeline on GitLab. **See more** opens the view in the rail.
- **It moves on its own.** A pipeline that is going is looked at every 30 seconds (10 with the view open), the whole list every few minutes, and nothing at all while Slack's window is hidden. Pressing **Refresh** looks at everything again.

## Setting it up

1. Create a **personal access token** in GitLab, under *Preferences*, *Access tokens*, with only the **`read_api`** scope. Nothing here writes to GitLab.
2. Install and switch on GitLab from the Browse shelf.
3. Click the GitLab tab in the rail (or **GitLab · Connect** in the top bar), check the address, paste the token, and **Connect**.

Your username comes from GitLab — nothing about it is configured.

## What it counts

`7/12` is jobs finished out of jobs that will run on their own. **Finished** means passed, failed (including a failure the pipeline allows) or canceled. **Manual** and **skipped** jobs are in neither number — a manual deploy would otherwise keep a pipeline from ever reading 12/12, and counting it as done would be untrue — and the count of manual jobs is said beside it. The row of stages is the information; the ratio is a summary.

A stage is as bad as its worst job: a failure shows at once, even while the rest of the stage is still running. A failed job its pipeline allows to fail shows as a warning, not as a failure. A job waiting for a person is grey, and does not colour its stage: a stage of passed jobs and a manual deploy reads as passed, and is grey only when nothing else is in it.

## Where the token is, and what is sent

The token is **not kept by this plugin**. It is handed once to BetterSlack's loader (`api.net.setCredential`), which keeps it in `~/.betterslack/credentials/gitlab-mrs.json`, readable by you only, and attaches it as a `PRIVATE-TOKEN` header to requests for the address in this plugin's settings — and for no other address. The page can set it and forget it, and can never read it. It is not in `settings.json`, so it is not in a backup. It is a plain file, **not encrypted**: protect it like the token it holds. Disconnecting, a token GitLab refuses, or removing the plugin deletes it.

What goes to GitLab is a path and an id: your user, your open merge requests, the projects they are in, their pipelines and their jobs. It is read-only. **Nothing from Slack is ever sent** — no message, no channel, no workspace, no Slack token — and the plugin does not read Slack's messages.

The last answers are kept in `~/.betterslack/data/gitlab-mrs/` (titles, branches, pipelines, jobs — no token), at most a day old and bounded in size, so a restart draws at once and then refreshes. Disconnecting deletes them.

## Settings

- **GitLab address** — the address you sign in at. Changing it signs you out: a token belongs to the address it was given for.
- **Pipeline in the top bar** — on by default.
- **Badge on the rail icon** — failing pipelines (default), open merge requests, or nothing.
