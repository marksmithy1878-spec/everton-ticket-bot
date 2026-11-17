# Everton daytime pilot — starts OFF

This is a local candidate for your ordinary Edge ticket checks. It adds Telegram
messages when the browser receives a fresh, plausible Liverpool section response.
It does not check the website for you, refresh it, click Try Again or buy tickets.
The laptop, ticket tab and Developer Tools must stay open and awake.
It does not provide dependable overnight monitoring.

The data reader has been demonstrated on Fulham. A real positive Liverpool
response-to-phone alert has not been demonstrated. All candidate ticket messages
say POSSIBLE TICKET OPPORTUNITY. Section counts may include ordinary tickets;
resale status, individual seat identity and purchase are unconfirmed.

## Setup, guided one action at a time

1. Extract the package and replace all files in the original extension folder.
2. Reload Everton Passive Check in edge://extensions. Its version is 0.3.0.
   Edge may require approval of the new api.telegram.org permission. That is
   for Telegram delivery; the extension requests no Everton site permission.
3. Reopen Everton Check in Developer Tools. Updating may discard old Network
   records. Do not repeatedly refresh the website to refill them.
4. Privately enter the correct bot token and CHAT_ID in the local panel. Never
   paste credentials into ChatGPT, screenshots, GitHub, reports or console commands.
5. Click Verify bot and send TEST. It must verify @EvertonResale_bot and the
   TEST must arrive on your phone. This leaves ticket alerts OFF.
6. Before arming, resolve the earlier possible token exposure. If it cannot be
   established that only a revoked token was exposed, rotate privately first.
   No Render settings or tokens have been changed by this candidate. Approval
   for any production setting change must be obtained separately.
7. Only after explicit approval, on the Liverpool event 1480 seating page,
   confirm TEST receipt and local pilot approval, then Start daytime pilot.
   Starting does not refresh the website. It ignores historical records.

The assistant should give only the next needed action, not this entire setup list
as a chat instruction. Do not enable live alerts simply because offline tests pass.

## While it is running

Continue normal manual website use. Avoid rapid retries. If new availability
responses arrive naturally or during those ordinary checks, the pilot can inspect
them and send a POSSIBLE alert. If the page does not fetch new data, the helper
has no new information. Do not mistake an open panel or status message for fresh
availability. There is no automatic checking interval.

HTTP 401/403/429 or a recognised restriction pauses the pilot. Its restriction
flag survives reopening. Leave website checks paused if you see a restriction;
the helper cannot guarantee it recognises every possible challenge page.
Leaving Liverpool or losing sign-in stops the session and clears credentials.
A normal reload of the same event can supply fresh native data while the pilot
is active; the helper itself never performs that reload.

Identical positive section snapshots are suppressed for 30 minutes. Different
snapshots can alert immediately. Counts cannot distinguish replacement seats
that leave the same totals, so this coarse duplicate rule may miss those changes.
A notification failure is not recorded as delivery; only a later fresh response
can retry after at least one minute. There is no stale-message resend queue.
Telegram timeouts can leave delivery uncertain, so exactly-once delivery is not
promised. Stop clears session credentials. Restarting requires another TEST and
approval, while delivered fingerprints and restriction flags remain local.

Ticket alerts can arrive at any hour. Routine hourly status messages are muted
from midnight to 6am UK time, including BST/GMT changes. Their wording separates
helper liveness from the time of the latest response. Sleeping or closing the
laptop/Developer Tools stops coverage; this is a daytime helper.

Keep just one pilot open in one browser profile. A lock prevents a second panel
in that profile from running at the same time. Different profiles/devices do not
share that lock. The Render worker remains suspended.
