# Device commands run on the main thread

**What to build:** Every command that talks to the Reader does its HID work off the
main thread, so a slow, wedged or absent Reader can never freeze the window. Today
`connect` is the only one that does, because it was the only one whose freezing was
diagnosed in the field.

**Cause, measured.** A synchronous `#[tauri::command]` is dispatched on the main
thread. `connect` was synchronous and called `HidApi::new()`, which enumerates every
HID device, so the event loop sat inside the call: the pointer became a wait cursor,
nothing repainted, and the window stopped answering. A development build made it a
hard deadlock, because React's StrictMode mounts effects twice and the second
`connect` blocked on the reader mutex on the main thread while the first held it
mid-enumeration. `connect` is now `async` and refuses a concurrent attempt.

**The rest of the surface has the same shape.** The command table registers 43
commands — 40 synchronous and 3 asynchronous — and synchronous is the default, so
the 17 of those 40 that reach the device do it through `with_reader`, which locks
the reader slot, opens the device on first use if the slot is empty, and then
performs the transfer — all on the main thread. (The other 23 synchronous commands
never touch a Reader: the library, the drafts, the console capability, the
read-only reveal, and the two password commands, which have no success path. The
three asynchronous commands are `connect`, `library_pick_file` and
`memory_dump_export`; only `connect` opens the device.) A production build hides
this because one attempt at a time is usually fast enough; it stops hiding the
moment a transfer is slow or a Reader wedges, which is exactly the situation the
wedged-reader handling exists for.

**Blocked by:** None

**Seams:** The command surface. Catches a command that is synchronous but reaches
the device, and a blocking call made while holding the reader slot; misses whether a
particular device actually answers in time, which only hardware settles.

**Tracker:** None
**Status:** ready

- [ ] No synchronous command performs HID I/O. A test enumerates the command table
      and fails on one that does, so a newly added command is a decision rather than
      an oversight.
- [ ] The reader slot is never held across blocking work — the device is opened and
      the transfer attempted first, and the slot only taken to store or drop it.
- [ ] A command that cannot proceed because another operation holds the device
      returns a reason instead of waiting, and that reason is distinguishable from
      "the Reader is absent".
- [ ] A wedged Reader produces a bounded failure within the documented wait while
      the window stays responsive, including while a screenshot is taken or a menu
      is opened.
- [ ] The existing synchronous behaviour is preserved where it is reached only in
      tests, or is converted with its tests.
