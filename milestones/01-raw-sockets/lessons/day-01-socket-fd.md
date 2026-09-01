# Day 1 — A socket is a file descriptor

## Theory

### What a socket actually is (not just "it's an int")

The `int` you get back from `socket()` is not the socket. It's a **handle** — an
index into your process's file descriptor table, which the kernel uses to look up the
real thing. The real thing is a kernel-side data structure that bundles together:

- the local address/port it's bound to (once you `bind()`)
- the remote address/port it's connected to (once you `connect()`/`accept()`)
- protocol state — for TCP specifically, this is a whole state machine
  (`LISTEN`, `SYN_SENT`, `ESTABLISHED`, `CLOSE_WAIT`, ...) that the kernel drives
  as packets arrive, entirely outside your process
- send and receive buffers — the kernel is buffering bytes on your behalf before
  your process ever calls `recv()`, which is exactly why short reads happen (more on
  that on Day 5/6)

So "a socket" is really closer to "a live object the kernel maintains on your
process's behalf," and your `int` is a ticket you hand back to the kernel every time
you want to do something with it (`send(fd, ...)`, `recv(fd, ...)`, `close(fd)`). This
is the same relationship a regular file fd has to the actual open-file state — sockets
were deliberately designed to slot into the exact same fd table as files, pipes, and
terminals, so the same `read`/`write`/`close`/`select` machinery works on all of them
almost interchangeably. That unification is arguably the single best design decision
in the whole API.

### Is this still how it actually works today?

Yes, genuinely — this isn't legacy cruft you're learning for historical interest.
Every mainstream networking stack — Boost.Asio, Python's `socket` module, Node's
`net`, Go's `net` package, the JVM's NIO — is, at the bottom, opening one of these
exact same fds with this exact same syscall. Asio's `async_read` eventually calls
`recv()` on a fd it got from `socket()`; it just also manages an event loop
(`epoll`/`io_uring`/IOCP depending on OS) so it doesn't have to block on it. You're not
learning a museum piece, you're learning the floor everything else stands on. Even
Windows agrees here — Winsock, Microsoft's socket API, is a near-clone of this same
BSD interface from the 1990s, because by then everyone had already agreed this was the
right shape.

What *has* changed over 40+ years is how you find out a socket is ready to be
read/written without blocking a whole thread on it — `select()` → `poll()` → `epoll()`
→ `io_uring` is basically the entire history of Linux I/O scalability in one line. But
notice: all of those are about *notification*, not about replacing the socket
abstraction itself. The fd and the `socket()`/`bind()`/`connect()` shape have been
stable since 1983.

### The call itself

```cpp
int fd = socket(AF_INET, SOCK_STREAM, 0);
```

Three arguments, three questions:

- **`AF_INET`** — *address family*. What kind of address will this socket use?
  `AF_INET` = IPv4. (`AF_INET6` for IPv6, `AF_UNIX` for local-machine-only sockets —
  same syscall, different address shape entirely.)
- **`SOCK_STREAM`** — *socket type*. What delivery guarantee do you want?
  `SOCK_STREAM` = TCP: reliable, ordered, connection-based byte stream. (`SOCK_DGRAM`
  = UDP: fire-and-forget packets, no connection.)
- **`0`** — *protocol*. Almost always `0`, meaning "pick the default protocol for that
  family+type combo" (TCP for `AF_INET`+`SOCK_STREAM`). You'd only set this
  explicitly in exotic cases (e.g. raw ICMP sockets).

On success: a small positive int, the fd. On failure: `-1`, with `errno` set — the
universal POSIX pattern of "sentinel return value, check `errno` for why," which is
why `strerror(errno)` shows up constantly in this milestone. `errno` itself predates
sockets by over a decade — it's a 7th-Edition-Unix-era (1979) mechanism, bolted onto
every syscall API that came after it, sockets included.

### What's still missing at this point

`socket()` only allocates the resource — it doesn't bind an address, doesn't listen,
doesn't connect. `bind()`, `listen()`, `accept()`/`connect()` are separate calls that
come on later days and give this fd an actual role. Allocate, then configure, then
use — that three-step shape repeats throughout this API.

### One more bit of trivia, since you asked for it

The name "socket" itself is a deliberate metaphor from the original design at UC
Berkeley (funded by DARPA, released as part of 4.2BSD in 1983): an endpoint you plug a
connection into, the same way you'd plug something into a wall socket or a phone jack.
The API predates HTTP by about eight years and predates "the web" as a concept
entirely — TCP/IP networking on Unix existed, and needed a programming interface,
before there was anything resembling a browser to use it.

## Task

Write a program that:

1. Calls `socket(AF_INET, SOCK_STREAM, 0)`
2. Checks the return value — on failure, print `strerror(errno)` and exit with a
   non-zero status
3. On success, prints the fd
4. Calls `close(fd)` on it before exiting

That's the whole program — no address, no `bind()`, no network activity yet.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day1 src/main.cpp` — zero warnings
- You'll need `<unistd.h>` for `close()`, in addition to `<sys/socket.h>`

### Checklist

- [ ] `socket()` return value checked before use
- [ ] `strerror(errno)` printed on failure
- [ ] non-zero exit status on failure
- [ ] `close(fd)` called on success
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

Run when you type `quiz`:

1. What does it mean if `socket()` returns `-1` versus returning `3`?
2. Why is the fd from `socket(AF_INET, SOCK_STREAM, 0)` not yet connected to anything
   or listening on any port — what's missing at this point?
3. If you called `socket(AF_INET, SOCK_DGRAM, 0)` instead, what would change about the
   guarantees you get, in your own words?
