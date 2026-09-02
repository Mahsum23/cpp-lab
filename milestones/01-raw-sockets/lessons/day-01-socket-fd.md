# Day 1 — A socket is a file descriptor

## Theory

### What a socket actually is

The `int` that `socket()` returns is not the socket. It's a **handle** — an index into
your process's file descriptor table, which the kernel uses to find the real thing.

The real thing lives in kernel memory and bundles together:

- the local address and port, once you `bind()`
- the remote address and port, once you `connect()` or `accept()`
- protocol state — for TCP, a whole state machine (`LISTEN`, `SYN_SENT`,
  `ESTABLISHED`, `CLOSE_WAIT`, `TIME_WAIT`, ...) that the kernel drives as packets
  arrive, entirely outside your process and whether or not you ever call `recv()`
- send and receive buffers, which is why the kernel can already be holding bytes for
  you before you ask for them, and why a `recv()` can hand back fewer bytes than were
  sent (Day 5 and Day 6)

So a socket is a live object the kernel maintains for you, and your `int` is a ticket
you hand back every time you want something done with it: `send(fd, ...)`,
`recv(fd, ...)`, `close(fd)`.

That's the same relationship a regular file's fd has to its open-file state. Sockets
were deliberately built to slot into the exact same table as files, pipes and
terminals, so `read`/`write`/`close`/`select` work on all of them almost
interchangeably. That unification is arguably the best design decision in the whole
API — and the reason "everything is a file" is a Unix slogan rather than a technicality.

### Go and look at the table

This is worth thirty seconds, because it turns the paragraph above into something you
have seen rather than something you were told. On Linux, the fd table is exposed as a
directory:

```console
$ ls -l /proc/$$/fd
lrwx------ 1 you you 64 Sep  2 19:04 0 -> /dev/pts/3
lrwx------ 1 you you 64 Sep  2 19:04 1 -> /dev/pts/3
lrwx------ 1 you you 64 Sep  2 19:04 2 -> /dev/pts/3
lrwx------ 1 you you 64 Sep  2 19:04 255 -> /dev/pts/3
```

`$$` is your shell's PID, and there are its three standard fds pointing at a terminal.
Once a process owns a socket, the same listing shows `3 -> socket:[123456]` — that
number in brackets is the kernel object's inode, and it's the actual identity of the
socket. Two processes sharing a socket after `fork()` show the *same* inode under
different fd numbers, which makes the handle-versus-object distinction impossible to
misremember afterwards.

### The call itself

```cpp
int fd = socket(AF_INET, SOCK_STREAM, 0);
```

Three arguments, three questions:

- **`AF_INET`** — *address family*. What kind of address will this socket use?
  `AF_INET` is IPv4; `AF_INET6` is IPv6; `AF_UNIX` is local-machine-only sockets,
  same syscall, completely different address shape.
- **`SOCK_STREAM`** — *socket type*. What delivery guarantee do you want?
  `SOCK_STREAM` is TCP: reliable, ordered, connection-based byte stream.
  `SOCK_DGRAM` is UDP: fire-and-forget datagrams, no connection.
- **`0`** — *protocol*. Almost always `0`, meaning "the default protocol for that
  family and type", which for `AF_INET` + `SOCK_STREAM` is TCP. You'd set it
  explicitly only in exotic cases, like raw ICMP sockets.

On success you get a small positive int. On failure, `-1`, with `errno` set — the
POSIX pattern of "sentinel return value, look in `errno` for the reason", which is why
`strerror(errno)` will appear in every program in this milestone. `errno` predates
sockets by a decade; it's a 1979-era mechanism that every syscall API since has been
bolted onto.

### A flag most people never learn about

The type argument is not just the type. On Linux you can OR flags into it:

```cpp
int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
```

`SOCK_CLOEXEC` marks the fd close-on-exec, so it is automatically closed if the process
`exec()`s another program. Without it, every fd you own is inherited by whatever you
launch — so a server that shells out to a helper hands that helper a live copy of its
listening socket. That leaks a resource, and worse, keeps the port occupied by a
process that has no idea it owns it.

You can also set this after the fact with `fcntl(fd, F_SETFD, FD_CLOEXEC)`, and that is
what people did for years. The reason the flag was added directly to `socket()` in 2008
is that the two-call version has a race: between `socket()` returning and `fcntl()`
running, another thread can `fork()` and `exec()`, and the fd escapes anyway. A race
window measured in nanoseconds, closed by moving one bit into the original call.

You don't need it today — this milestone never calls `exec()`. It's here because it's
the kind of detail that separates code that works from code that survives, and because
`accept4()` on Day 4 has the same flag for the same reason.

### Is this still how it works?

Yes, and that's the point of building it by hand. Every mainstream networking stack —
Boost.Asio, Python's `socket`, Node's `net`, Go's `net`, the JVM's NIO — is opening one
of these fds with this syscall at the bottom. Asio's `async_read` ends up calling
`recv()` on an fd it got from `socket()`; what it adds is an event loop so nothing has
to block while waiting. Even Windows agrees: Winsock is a near-clone of this BSD
interface, because by the 1990s everyone had settled on this shape.

What *has* changed in forty years is how you find out a socket is ready without parking
a thread on it: `select()` → `poll()` → `epoll()` → `io_uring` is most of the history of
Linux I/O scalability in one line. But every one of those is about *notification*. None
of them replaced the socket. The fd, and the `socket()`/`bind()`/`connect()` shape, have
been stable since 1983.

### Where the name comes from

"Socket" is a deliberate metaphor from the original Berkeley design (DARPA-funded,
shipped in 4.2BSD in 1983): an endpoint you plug a connection into, like a wall socket
or a phone jack. The API predates HTTP by about eight years, and predates the web as a
concept entirely. TCP/IP on Unix needed a programming interface long before there was a
browser to point at it.

## Task

Write a program that:

1. Calls `socket(AF_INET, SOCK_STREAM, 0)`
2. Checks the return value — on failure, print `strerror(errno)` and exit non-zero
3. On success, prints the fd
4. Calls `close(fd)` before exiting

That's the whole program. No address, no `bind()`, no network activity yet.

Then, before you close it, find your socket in the fd table. Add a
`std::getchar();` right before the `close()` so the process waits, run it, and in
another terminal:

```console
$ ls -l /proc/$(pgrep -n day1)/fd
```

You should see your fd pointing at `socket:[...]`. Predict the fd number before you
look. Then take the `getchar()` back out.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day1 src/main.cpp`
- You'll need `<unistd.h>` for `close()`, `<cstring>` for `strerror`, and
  `<cerrno>` for `errno`, alongside `<sys/socket.h>`

### Checklist

- [ ] `socket()` return value checked before use
- [ ] `strerror(errno)` printed on failure
- [ ] non-zero exit status on failure
- [ ] `close(fd)` called on success
- [ ] found the fd in `/proc/<pid>/fd`, and predicted its number correctly
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. What does it mean if `socket()` returns `-1` versus returning `3`?
2. Why is the fd from `socket(AF_INET, SOCK_STREAM, 0)` not yet connected to anything
   or listening on any port — what's missing?
3. A program calls `socket()` ten thousand times in a loop and never calls `close()`.
   What actually runs out, and how does the failure show up?
4. `SOCK_CLOEXEC` exists because doing the same job with a later `fcntl()` call has a
   race. What is the race, and what escapes through it?
5. When Asio hands you `co_await socket.async_read_some(...)`, what has replaced the
   raw `recv()` call underneath?
