# Progress Log

Format: what you built, what broke, what you learned that wasn't in the spec.
The third column is the valuable one. Be honest in it.

| Milestone | Started | Done | Review | Teach-back | Notes |
|---|---|---|---|---|---|
| 01-raw-sockets | 2026-09-01 | | | | Day 1/8 in progress (see log) |

## Log

### 01-raw-sockets

**Day 1 — a socket is a file descriptor (2026-09-01):**
- Theory covered: socket = kernel-side object, the `int` is just a handle/ticket into
  the fd table; `socket(AF_INET, SOCK_STREAM, 0)` args; `-1`+`errno` failure pattern;
  still how everything (Asio/Go/Node) works underneath today.
- Quiz: 3/3 (failure-return vs valid fd; what's missing before bind/listen/connect;
  SOCK_DGRAM = UDP guarantees).
- Task attempted: `src/main.cpp` calls `socket()`, checks it, prints the fd. Compiles
  clean under `-Wall -Wextra`, prints `fd = 3`.
- **Code review — pending fixes (not yet applied):**
  1. Never calls `close(fd)` — the task's other half; build the open/close-pairing
     habit now.
  2. Failure branch prints the error but still falls off `main()` returning 0 — a
     shell checking `$?` would see success. Needs a non-zero exit on failure.
- Next session (after the fix): Day 2 — addresses and byte order.

_(write here as you go — what you tried, what confused you, what you got wrong)_

**Side track:** started designing an installable PWA learning app to deliver this
curriculum on the phone — design doc at `app/DESIGN.md`, awaiting review of the 5 open
decisions in §11. This is Claude's build, not practice; it doesn't replace writing C++.
