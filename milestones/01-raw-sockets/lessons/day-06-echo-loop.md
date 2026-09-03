# Day 6 — The echo loop for one client

## Theory

### One send() is not one recv()

This is the day the abstraction you have been half-assuming falls over.

TCP is a **byte stream**. It guarantees that every byte you send arrives, exactly once,
in order. It guarantees nothing whatsoever about *grouping*. The boundaries between your
`send()` calls are not transmitted, not recorded, and not recoverable — they exist only
in your process's memory and are gone the moment the bytes hit the kernel.

So a client that does this:

```cpp
send(fd, "HELLO", 5, 0);
send(fd, "WORLD", 5, 0);
```

may produce, on the server, any of:

- one `recv()` returning `HELLOWORLD` (10 bytes, both writes coalesced)
- two `recv()`s returning `HELLO` then `WORLD` (what you naively expect)
- three `recv()`s returning `HEL`, `LOWOR`, `LD` (split anywhere at all)

All three are correct TCP. Nothing is broken. The stream was delivered in order and
intact; only your assumption about framing was imaginary.

This is why every real protocol over TCP has to define its own message boundaries, and
there are only three ways to do it: a **length prefix** (send the size, then that many
bytes — what most binary protocols do), a **delimiter** (read until `\n` — what HTTP
headers, SMTP and IRC do), or **close the connection to mean "done"** (HTTP/1.0's
original answer, and the reason `Content-Length` had to be invented).

An echo server is the one case where you can dodge the question entirely, because
echoing bytes back doesn't require understanding where a message starts or ends. Enjoy
that; you don't get it again.

### Short writes: the mirror image

`send()` can accept fewer bytes than you gave it. Its return value is the count it took.

The reason is Day 5's buffer, from the other side: the kernel copies your bytes into the
socket's send buffer, and if that buffer is nearly full — because the network is slower
than you, or the peer isn't reading — it takes what fits and returns. It doesn't wait
for room unless the socket is blocking *and* the buffer is completely full.

So this is a bug:

```cpp
send(conn, buf, n, 0);      // wrong: ignores the return value
```

and this is the correct shape:

```cpp
size_t sent = 0;
while (sent < n) {
    ssize_t k = send(conn, buf + sent, n - sent, 0);
    if (k < 0) { /* handle EINTR by retrying, everything else is fatal */ }
    sent += static_cast<size_t>(k);
}
```

You will almost never see a short write on loopback with small messages, which is
exactly what makes it dangerous: the code looks correct for months, then truncates data
the first time it runs against a slow client on a real network. To force one, you need a
peer that stops reading while you keep writing until the send buffer fills.

### SIGPIPE will kill your server, silently

Write to a socket whose peer has fully closed, and the kernel raises **`SIGPIPE`**, whose
default disposition is to **terminate your process**. Not an error return — process
death, with no message.

The first `send()` after the peer disappears often succeeds (the bytes go into your send
buffer, the failure isn't known yet). It's the *second* one that kills you. So a server
that doesn't handle this dies at an unpredictable moment, with no log line, whenever a
client hangs up rudely. It looks like a crash with no cause.

Three fixes, any of which works:

- pass **`MSG_NOSIGNAL`** to each `send()` — the signal is suppressed and you get `-1`
  with `EPIPE` instead, which is what you actually wanted
- `signal(SIGPIPE, SIG_IGN)` once at startup, same effect process-wide
- set `SO_NOSIGPIPE` on the socket (BSD and macOS; not Linux)

Handling it as an ordinary error is always right. `EPIPE` means "this connection is
over" and belongs on the same path as `recv()` returning 0.

### Nagle and delayed ACK: the classic 40 ms

Two optimisations, each sensible alone, that interact badly.

**Nagle's algorithm** (1984) stops a socket from sending a small segment while a
previous small segment is still unacknowledged — it buffers the little writes and sends
them as one. It exists because of a real crisis: telnet sessions were putting a
41-byte packet on the wire for every single keystroke, and the overhead was congesting
early networks.

**Delayed ACK** does the opposite favour: on receiving data, wait a moment (up to 40 ms
on Linux, 200 ms elsewhere) before acknowledging, hoping to piggyback the ACK on a reply
and save a packet.

Put them together in a request-response protocol where one side writes in two pieces,
and you get a standoff: the sender is holding the second piece until the first is ACKed;
the receiver is holding the ACK hoping for data to attach it to. Nobody moves until the
delayed-ACK timer expires. The result is a mysterious, wildly reproducible ~40 ms stall
per exchange that shows up in production and vanishes under a profiler.

The fix is `TCP_NODELAY`, which turns Nagle off:

```cpp
int yes = 1;
setsockopt(conn, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
```

Essentially every RPC framework, database driver and game server sets it. Note it goes on
the *connected* socket, and note the name is a double negative you'll misread at least
once: `TCP_NODELAY = 1` means "do not delay", i.e. Nagle **off**.

Being honest about what you'll see today: on loopback, with an echo server, you probably
*won't* reproduce the stall — there's no real network latency, and the traffic pattern
is too simple to trigger the standoff. Knowing the mechanism matters more than measuring
it here; the day you meet an unexplained 40 ms in a request/response system, you'll know
where to look immediately.

## Task

Turn Day 5's single exchange into a loop:

1. Loop: `recv()` into a buffer, and echo back exactly the bytes that arrived.
2. Exit the loop cleanly when `recv()` returns `0` (peer hung up), and on error report
   `strerror(errno)` — but retry rather than bail on `EINTR`.
3. Write the send loop properly, so a short write can't truncate your echo. Even though
   you're unlikely to see one today, write it as if you will.
4. Suppress `SIGPIPE` by whichever of the three methods you prefer, and handle `EPIPE`
   as a normal end-of-connection.
5. Close the connected socket when the loop ends. Leave the listening socket alone —
   Day 4's rule.

Two experiments:

**Kill the server with SIGPIPE, then fix it.** First *without* any SIGPIPE handling:
connect with `nc`, then kill `nc` abruptly (Ctrl-C) while your server is mid-echo, and
watch your server die. Confirm what killed it — a process terminated by SIGPIPE exits
with status 141:

```console
$ ./day6; echo "exit=$?"
```

Then add the suppression and confirm you get `EPIPE` as a return value instead, and the
server survives.

**Prove the byte stream has no boundaries.** Paste a large blob into `nc` in one go, with
a deliberately small server buffer (64 bytes is plenty):

```console
$ head -c 4000 /dev/urandom | base64 | tr -d '\n' | nc 127.0.0.1 9000
```

Count how many `recv()` calls it takes. One `send()` on the client became many reads on
the server, and the sizes are whatever the network felt like.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day6 src/main.cpp`
- You'll need `<netinet/tcp.h>` if you experiment with `TCP_NODELAY`, `<csignal>` for
  the signal approach

### Checklist

- [ ] loop exits cleanly on `recv()` returning 0, distinctly from the error path
- [ ] `EINTR` retried rather than treated as fatal
- [ ] `send()` wrapped in a loop that handles a partial write
- [ ] `SIGPIPE` suppressed, `EPIPE` handled as end-of-connection
- [ ] observed the server dying with exit status 141 before the fix
- [ ] one client `send()` observed arriving as several `recv()`s
- [ ] connected socket closed, listening socket left open
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. A client calls `send()` twice, with `"HELLO"` then `"WORLD"`. List what the server's
   `recv()` calls might legitimately return, and explain why.
2. Given that, how does any real protocol over TCP know where one message ends and the
   next begins?
3. `send(conn, buf, n, 0)` returns a value smaller than `n`. What happened, and what
   must your code do about it?
4. Your server dies with no log output whenever a client disconnects abruptly. What is
   killing it, and why does the *first* `send()` after the disconnect often succeed?
5. `TCP_NODELAY` disables Nagle's algorithm. What problem was Nagle solving, and what
   does it interact badly with?
