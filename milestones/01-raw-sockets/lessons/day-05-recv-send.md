# Day 5 — recv() and send(), once each

## Theory

### The return value is a count, not a message

```cpp
ssize_t recv(int sockfd, void *buf, size_t len, int flags);
ssize_t send(int sockfd, const void *buf, size_t len, int flags);
```

```cpp
char buf[1024];
ssize_t n = recv(fd, buf, sizeof(buf), 0);   // 0 = no flags
```

Note the return type: `ssize_t` is *signed*, precisely so `-1` can mean failure — which
is why assigning it straight into a `size_t` turns an error into a gigantic length, a
bug this API invites and `-Wconversion` catches.

`recv()` returns the number of bytes it put in your buffer. Not "a message", not "the
thing the client sent" — a count of bytes, and it can be smaller than what you asked for
and smaller than what the client sent in one go.

Three outcomes, and all three must be handled:

- **`n > 0`** — that many bytes are in your buffer. Nothing more is promised. In
  particular there is no null terminator, so treating `buf` as a C string without
  writing one yourself reads whatever was in memory after the data.
- **`n == 0`** — **orderly shutdown**. The peer sent a FIN: they have closed their
  sending side and no more data will ever arrive on this connection. This is not an
  error, and it is not "nothing arrived yet" — a blocking `recv()` never returns 0 for
  "wait a moment". Zero means end of stream, permanently.
- **`n < 0`** — error, with the reason in `errno`. `ECONNRESET` means the peer's end
  died rudely (an RST rather than a FIN). `EINTR` means a signal interrupted the call
  before any data arrived, and you should simply call it again.

The 0-versus-negative distinction is the one that matters most, because they demand
opposite reactions: `0` is a normal end-of-conversation you should close cleanly on,
`-1` is a failure you should report. Code that lumps them together as "the loop is over"
silently swallows real errors.

`send()` mirrors it, and has the same trap in the other direction: **its return value is
how many bytes it actually accepted**, which can be fewer than you asked it to send.
That's Day 6's problem, but the return value is the same kind of promise — a count, not
an acknowledgement.

Neither call tells you anything about whether the data reached the other machine.
`send()` returning 512 means 512 bytes are now in the kernel's send buffer and are the
kernel's problem. It does not mean they arrived, and there is no socket API call that
tells you they did.

### The kernel's buffer is not your buffer

Every socket has receive and send buffers in kernel memory (Day 1's list). Bytes arrive
from the network into the receive buffer whether or not your process ever calls
`recv()`, and `recv()` copies from that buffer into yours and *removes* what it copied.

You can prove this in two lines with a flag most people never learn, `MSG_PEEK`, which
copies without consuming:

```cpp
recv(fd, buf, sizeof(buf), MSG_PEEK);   // look
recv(fd, buf, sizeof(buf), MSG_PEEK);   // look again — identical bytes
recv(fd, buf, sizeof(buf), 0);          // now actually take them
recv(fd, buf, sizeof(buf), MSG_DONTWAIT); // -1, EAGAIN — the buffer is empty
```

Run that and the first two calls return the same bytes and the same count. Nothing about
the connection changed between them; the data was sitting in kernel memory the whole
time, and "reading" is a copy-and-remove operation, not an event.

`MSG_PEEK` is genuinely useful beyond the demo: protocol dispatchers use it to look at
the first few bytes and decide which handler should own the connection before any of the
data has been consumed. It's also a good way to lose an afternoon, because peeking in a
loop while waiting for more data is a busy-wait that will happily spin a core.

Two other flags worth knowing exist:

- **`MSG_WAITALL`** — don't return until the full requested count has arrived (or the
  connection ends). It turns the short-read problem off for a fixed-size read, and it's
  the right tool when you genuinely know the length in advance:

  ```cpp
  ssize_t n = recv(fd, header, 8, MSG_WAITALL);   // all 8 bytes, or the connection ended
  ```
- **`MSG_DONTWAIT`** — make just this one call non-blocking, returning `EAGAIN` rather
  than sleeping. Per-call, so you don't have to change the socket's mode:

  ```cpp
  ssize_t n = recv(fd, buf, sizeof(buf), MSG_DONTWAIT);
  if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) { /* nothing there right now */ }
  ```

### Why a short read is normal, not an error

You ask for 1024 bytes; the client sent 4000. `recv()` gives you, say, 1448 — or 512, or
73. It returns what's in the receive buffer *now* rather than waiting for more, because
TCP is a stream and there is no "rest of the message" for it to wait for: it has no idea
where your message ends. Bytes arrive in whatever chunks the network and the sender's
kernel produced, and those chunks have nothing to do with the sizes the sender passed to
`send()`.

Today you call `recv()` exactly once and see this happen. Tomorrow you loop, which is
where it stops being a curiosity and starts being a bug you have to design against.

## Task

Extend Day 4's program. After `accept()`:

1. `recv()` **once** into a buffer. Check all three outcomes explicitly — `> 0`, `== 0`,
   `< 0` — and print which one you got, with `strerror(errno)` on the error path.
2. Print how many bytes arrived, and the bytes themselves. Print the count *before* the
   content, so a mismatch between "how much" and "what" is obvious.
3. `send()` those exact bytes back — exactly `n` of them, not `sizeof(buf)`. Check its
   return value and print how many it accepted.
4. Close both sockets. No loop, even though you will want one.

Then the experiment, which is the point of today:

Before your real `recv()`, add two `MSG_PEEK` reads and print what each returns. Confirm
you get the same bytes twice, that the normal `recv()` afterwards still gets them, and
that a following `MSG_DONTWAIT` read returns `-1` with `EAGAIN`. That sequence is the
kernel's buffer, your buffer, and the difference between them, made visible.

Feed it with `nc 127.0.0.1 9000` and type a line. Then try feeding it something much
larger than your buffer to see a short read:

```console
$ head -c 100000 /dev/urandom | base64 | nc 127.0.0.1 9000
```

**Then watch the kernel hold bytes you haven't asked for yet.** `MSG_PEEK` shows the
buffer exists; this shows how much is in it. Temporarily comment out your `recv()` so
the server accepts the connection and then just sits there, and send it something
substantial:

```console
$ head -c 200000 /dev/zero | tr '\0' 'x' | nc 127.0.0.1 9000
```

While that's running, in a third terminal:

```console
$ ss -tan | grep 9000
```

The server's `ESTAB` row will show a large `Recv-Q` — bytes the kernel accepted, ACKed
and is holding for a process that has never called `recv()`. (No `ss`? The same numbers
are in `/proc/net/tcp`, in hex, in the `tx_queue:rx_queue` column.) Then put the
`recv()` back, run it again, and watch `Recv-Q` stay near zero because you're draining
it. That difference is the entire point of today.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day5 src/main.cpp`

### Checklist

- [ ] all three `recv()` outcomes handled distinctly, not collapsed into two
- [ ] byte count printed, and only `n` bytes echoed back — never `sizeof(buf)`
- [ ] `send()` return value checked and printed
- [ ] `MSG_PEEK` read the same bytes twice, then a normal `recv()` consumed them
- [ ] saw a short read: asked for the full buffer, got fewer bytes than were sent
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. What does `recv()` returning `0` mean, and why is it a different situation from
   returning `-1`?
2. You call `recv(fd, buf, 1024, 0)` and the client sent 4000 bytes. What can you say
   about the return value, and where are the remaining bytes?
3. `send()` returns 512 when you asked it to send 512 bytes. What has actually happened
   at that point, and what has *not*?
4. Two consecutive `MSG_PEEK` reads return the same bytes. What does that tell you about
   where the data lives and what a normal `recv()` does?
5. Your code does `buf[n] = '\0'` after a successful `recv()` and prints `buf` as a
   string. What is the assumption there, and when does it bite?
