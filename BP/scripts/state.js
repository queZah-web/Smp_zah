// players that currently have a shop screen open (the HUD must not touch the screen while a form is open)
export const formBusy = new Set();
// players that are in combat (the action bar shows the combat timer; the "action bar" scoreboard style waits)
export const combatBusy = new Set();
// players that currently see the skill (mining level) bar in the action bar (the "action bar" scoreboard style waits)
export const skillBusy = new Set();
// players that currently see a table-pass countdown in the action bar (the "action bar" scoreboard style waits)
export const passBusy = new Set();
// players that currently see a /pay notice in the action bar (the "action bar" scoreboard style waits)
export const payBusy = new Set();
// players that are inside the AFK area (the timer owns the action bar)
export const afkBusy = new Set();
// players that currently see a clan notification (e.g. "Hussein joined the server") in the action bar (the scoreboard bar / combat bar wait)
export const clanBusy = new Set();
