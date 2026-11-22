# 0010: A growing list of choices is an in-app list with search, not a native menu

**Status:** Accepted
**Date:** 2026-11-22

## Context

The app asks the user to choose one thing from a list in two places that matter: the
Draft a 13.56 MHz Tag should receive, and the Record type a Draft's next entry should
be. The library has no cap on how many Drafts it holds — the store appends and never
prunes, and Library's own comments speak of "several hundred entries" — so one of
those lists grows without limit and the other is a fixed set of eleven.

There was already a decision in the code, and it argued the other way. The native
`<select>` module says, in as many words, that it is native *because* both lists it
served could grow, and that "the platform's own menu is the one the user already knows
how to drive with a keyboard". That reasoning is sound about a handful of options and
fails past a few dozen: a platform menu cannot be typed at, so finding one Draft by
name in several hundred is a scroll, and there is no way to search a Draft by what is
inside it at all.

The alternatives were weighed rather than assumed: a native menu (familiar and
keyboard-complete, unsearchable), a popover combobox (searchable, but a floating layer
over a 900×700 window with its own focus and dismissal problems), and a full
list-and-detail pane (the most room, and a second copy of the Drafts page inside a band
page).

## Decision

**A list of choices is a native menu only when it is a short, fixed enumeration. A list
that grows is an in-app list with a search field over it.**

The 13.56 MHz Draft choice becomes the in-app list: rows in a labelled group, each
marked with `aria-pressed` when chosen, narrowing as the user types over the Draft's
name, its id and the authored values inside its Records. The remaining selects — Record
type, Wi-Fi authentication and encryption — stay native, because they are the first case
and nothing about them grows.

The trade-off taken knowingly: **the platform menu's keyboard completeness is given up.**
A group of buttons is Tab-navigable but not arrow-navigable, and its type-ahead is gone.
The search field replaces type-ahead for this list, and does more than type-ahead did;
arrow-key traversal is a real loss, accepted because the list it applies to is long
enough that nobody traverses it linearly.

## Consequences

Easier: a library of hundreds of Drafts stays usable, a Draft is findable by what is
inside it, and the app has one pattern for "choose one of these" that is already used by
both Collections.

Harder: every future picker now has a rule to satisfy rather than a default to copy, and
the in-app list must carry the accessibility work a native menu got for free — a labelled
group, a pressed state, a no-match state in words, and a bounded scroll height.

Committed to: the native-select module's comment no longer argues for native menus on
lists that grow. If a picker of a growing list is ever added as a `<select>` again, this
ADR is the thing that was ignored.
