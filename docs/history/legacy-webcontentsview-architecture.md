# Archive Notes

## Archive reason

This project is paused because the most important requirement could not be implemented reliably with the current Electron WebContentsView architecture.

The original goal was:

- Use the official ChatGPT website.
- Use the user's existing ChatGPT subscription.
- Avoid OpenAI API billing.
- Avoid third-party platforms.
- Keep one official ChatGPT sidebar.
- Let that official sidebar control multiple independent ChatGPT panes.
- Allow official sidebar menus and popovers to overlay the right-side panes correctly.

The experiment showed that this is not stable.

## Technical limitation

The project uses separate Electron WebContentsView instances:

sidebarView = one full ChatGPT web page
paneView 1 = another full ChatGPT web page
paneView 2 = another full ChatGPT web page
paneView 3 = another full ChatGPT web page

Because these are separate web contents, they do not share the same DOM or z-index layer.

This means the official ChatGPT sidebar popovers cannot be cleanly rendered above the independent right-side panes.

## Failed approaches

### 1. Keep the official sidebar always visible

This worked partially, but official sidebar popovers could be covered by the right-side panes.

### 2. Move the sidebarView above the panes on hover

This caused the whole ChatGPT page inside sidebarView to cover the right-side panes, not just the sidebar popover.

### 3. Shrink sidebarView to only the sidebar width

This caused ChatGPT to enter a smaller responsive layout. The official sidebar changed shape, popovers moved incorrectly, and an extra conversation view could appear.

### 4. Add safe spacing between sidebar and panes

This prevented some overlap, but it compressed the right-side conversation panes and still did not match the desired behavior.

## What worked

- Official ChatGPT loaded in Electron.
- Login state persisted.
- Multiple ChatGPT panes could run.
- Pane count switching worked.
- Active pane selection worked.
- Active pane highlight worked after bug fixes.
- Right-side internal sidebar hiding partially worked.

## What did not work reliably

- One official ChatGPT sidebar controlling multiple independent panes.
- Official sidebar menus overlaying right-side panes.
- Keeping the official sidebar in desktop layout while exposing only the sidebar area.
- Avoiding ChatGPT responsive layout problems when resizing the sidebar view.

## Future options

1. Wait for official ChatGPT multi-pane or workspace support.
2. Rebuild with a fully custom sidebar and manually managed conversation URLs.
3. Use OpenAI API to build a fully custom workspace, but this would not use ChatGPT Plus quota.
4. Return to the simpler multi-window version if only parallel ChatGPT usage is needed.

## Current decision

Do not continue development for now.

Archive the current state to GitHub and revisit only if a better method becomes available.
