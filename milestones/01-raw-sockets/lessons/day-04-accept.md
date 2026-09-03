# Day 4 — accept()

## Theory

### Two file descriptors, one connection

```cpp
int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen);
```

```cpp
sockaddr_in peer{};
socklen_t len = sizeof(peer);          // must be initialised — see below
int conn = accept(listen_fd, reinterpret_cast<sockaddr *>(&peer), &len);
```

`accept()` hands back a **new** fd. Your listening fd is untouched and still in `LISTEN`,
still collecting handshakes the kernel completes for you. The new one represents exactly
one conversation with exactly one client.

This is the single most-missed fact in hand-rolled socket code, and every bug that comes
from missing it looks baffling: servers that serve one client and then hang forever,
servers that die when a client disconnects, servers that accept a second connection onto
the first client's socket. All of them are the same mistake — treating the two fds as
interchangeable.

If you only remember one sentence from this milestone, make it this one: **the listening
socket is a factory, the accepted socket is a product.** You close products when you're
done with them. You do not close the factory.

### Why a new fd is the only design that works

The deeper answer is about how TCP identifies a connection at all. A connection is not
named by a port. It's named by a **four-tuple**: local IP, local port, remote IP, remote
port. All four together.

So when three clients connect to your server, you get three connected sockets that all
share the *same* local port 9000, and differ only in the remote half:

```
127.0.0.1:9000  <->  127.0.0.1:51234
127.0.0.1:9000  <->  127.0.0.1:51235
127.0.0.1:9000  <->  127.0.0.1:51236
```

Port 9000 is not "used up" by the first client, and it never gets divided between them.
That's also why a busy web server can hold sixty thousand simultaneous connections on
port 443 without running out of anything port-shaped. Each of those needs its own kernel
socket object — its own buffers, its own sequence numbers, its own state machine — and
therefore its own fd. There is nowhere else for them to live.

### The kernel fills in the address for you

The second and third arguments are how you find out who connected. You pass a buffer and
*a pointer to* its size; the kernel writes the peer's address into the buffer and writes
the number of bytes it actually used back through the pointer.

That in-and-out parameter is called a **value-result** argument, and it's all over this
API for one reason: C can't return two things. You must initialise `len` to the size of
your buffer before the call — passing an uninitialised `socklen_t` is a real and
irritating bug, because it often "works" by accident when the stack garbage happens to
be large enough.

If you don't care who connected, both arguments can be `nullptr`.

To print the address, use `inet_ntop()` and not `inet_ntoa()` — Day 2 covered why the
older one hands you a pointer into a static buffer that the next call overwrites:

```cpp
const char *inet_ntop(int af, const void *restrict src,
                       char *restrict dst, socklen_t size);
```

```cpp
char ip[INET_ADDRSTRLEN];
inet_ntop(AF_INET, &peer.sin_addr, ip, sizeof(ip));
std::printf("client %s:%u\n", ip, ntohs(peer.sin_port));
```

### accept4(), and Day 1's race again

Linux has `accept4()`, which takes the same arguments plus a flags word:

```cpp
int accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags);
```

```cpp
int conn = accept4(listen_fd, nullptr, nullptr, SOCK_CLOEXEC);  // nullptr: don't care who
```

This is exactly the `SOCK_CLOEXEC` problem from Day 1, one level up. Close-on-exec is
*not* inherited from the listening socket, so every connection you accept starts life
inheritable by any program you `exec()`. Setting it afterwards with `fcntl()` reopens the
same nanosecond race Day 1 described. `accept4()` closes it by doing both in one syscall.

`SOCK_NONBLOCK` is the other flag it takes, and that one becomes interesting the moment
you have an event loop — milestone 02's problem rather than today's.

### What blocking actually means here

Your `accept()` will block. The process stops, the kernel deschedules it, and it consumes
no CPU at all while waiting — this is a sleep, not a spin. When a connection lands in the
accept queue, the kernel wakes you and `accept()` returns.

That's fine for one client at a time and completely useless for many, which is the
motivation for most of the rest of this curriculum. It's also the origin of a classic
piece of systems folklore: if several processes are blocked in `accept()` on the *same*
listening socket and one connection arrives, older kernels woke all of them, and all but
one immediately went back to sleep having found nothing. That's the **thundering herd**;
modern Linux wakes only one, but the phrase outlived the bug and now gets used for any
stampede-on-a-single-event problem.

### Go and look at both sockets

With a client connected, your process holds two sockets on port 9000 in different
states. They show up separately:

```console
$ ss -tan | grep 9000
LISTEN  0  4096   0.0.0.0:9000    0.0.0.0:*
ESTAB   0  0    127.0.0.1:9000  127.0.0.1:51234
```

One row is the factory, still listening. The other is the product — same local port,
different remote address, which is the four-tuple made visible. `/proc/<pid>/fd` from
Day 1 shows them as two separate `socket:[...]` entries with different inode numbers.

## Task

Extend Day 3's program:

1. After `listen()`, call `accept()` **once**, into a `sockaddr_in` with a properly
   initialised `socklen_t`.
2. Print both fds — the listening one and the connected one — clearly labelled. Predict
   the connected fd's number before you run it.
3. Print the client's IP and port, using `inet_ntop()` for the address and `ntohs()` for
   the port. Both come out of the struct the kernel filled in.
4. `close()` **both** sockets and exit.

Trigger it from another terminal with `nc 127.0.0.1 9000`. No client program of your own
yet — that's Day 7.

Then the experiment: while the connection is open (a `std::getchar()` before the closes
will hold it), run `ss -tan | grep 9000` in another terminal and find both rows. Confirm
the local port is identical on both and only the remote half differs.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day4 src/main.cpp`
- You'll need `<arpa/inet.h>` for `inet_ntop`

### Checklist

- [ ] `accept()` return value checked, `socklen_t` initialised before the call
- [ ] both fds printed and distinguishable, connected fd predicted correctly
- [ ] client IP and port printed, using `inet_ntop` rather than `inet_ntoa`
- [ ] both sockets closed
- [ ] saw `LISTEN` and `ESTAB` rows sharing the same local port
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. `accept()` returns a new fd rather than reusing the listening one. What is the
   listening socket doing while you're talking to a client, and what breaks if you close
   the wrong one?
2. Three clients are connected to your server on port 9000 at the same time. What
   distinguishes their three connections from each other, given they share a local port?
3. The `socklen_t` argument to `accept()` is passed by pointer rather than by value.
   Why — and what goes wrong if you forget to initialise it?
4. What does `accept4(fd, ..., SOCK_CLOEXEC)` give you that `accept()` followed by
   `fcntl(F_SETFD, FD_CLOEXEC)` does not?
5. Your process is blocked in `accept()` with no clients connecting. What is it costing
   the machine while it waits?
