# Day 3 — bind() and listen()

## Theory

### Two calls, two completely different jobs

Day 1 gave you a socket with no address. Day 2 built the address. Today they meet, and
then a second call turns the result into something that can receive connections.

```cpp
bind(fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));
listen(fd, 128);
```

`bind()` is the claim: *this socket owns port 9000 on these interfaces.* From the moment
it returns, no other socket can hold that same (address, port) pair — the kernel keeps a
table of bound endpoints, and yours is now in it. That's the whole job. A bound socket
still can't accept anything.

`listen()` is the state change. It takes the socket from "has an address" to
`LISTEN` — the TCP state machine from Day 1 finally starts running. The kernel begins
answering SYN packets on that port on your behalf, completing handshakes *without your
process being involved at all*, and stacking the finished connections somewhere for you
to collect later.

That "somewhere" is the interesting part.

### The backlog is a queue of finished handshakes

The second argument to `listen()` is the backlog, and almost everyone's first guess
about what it queues is wrong. It is not a queue of bytes, and it is not a limit on how
many clients you can serve. It's the depth of the queue of **connections the kernel has
already completed the three-way handshake for, which your code has not yet called
`accept()` on.**

Read that again, because it has a consequence people find genuinely surprising: a client
can `connect()` successfully, send data, and get an acknowledgement, all while your
server is busy elsewhere and has never heard of it. The handshake is the kernel's
business, not yours. `accept()` doesn't create the connection — it hands you one the
kernel finished earlier.

So the backlog is a shock absorber. If ten clients connect during the second your
process spends serving someone else, they sit in that queue and get accepted as soon as
you come back around. If the queue is full when an eleventh arrives, the kernel's
behaviour depends on configuration, but the usual outcome on Linux is that it drops the
SYN, and the client's TCP stack retries a moment later — so the client sees a slow
connect rather than a refused one.

Linux actually keeps two queues here: a SYN queue for handshakes *in progress* and an
accept queue for handshakes that are *done*. The backlog argument sizes the second one.
(The split exists partly because of SYN flood attacks — a trivially cheap DoS where an
attacker sends handshake openings and never completes them, filling a single combined
queue with garbage. SYN cookies, which let the kernel forget about half-open connections
entirely and reconstruct them from the client's reply, were invented in 1996 for exactly
this.)

### Your backlog number is a suggestion

Pass `listen(fd, 4096)` and you will very likely not get 4096. Linux silently clamps the
value to `net.core.somaxconn`, and it does not tell you:

```console
$ cat /proc/sys/net/core/somaxconn
4096
```

That default was `128` for most of Linux's history and only changed to `4096` in kernel
5.4 (2019) — which means a decade of servers all over the internet were quietly running
with a backlog two orders of magnitude smaller than the number in their source code.
Nothing warns you. The call succeeds either way.

### Reproducing "Address already in use" on purpose

This is the classic restart failure, and the usual folklore version of it —
*"start the server, kill it, start it again, and bind fails"* — is **wrong**. Try it
with a server that has only ever listened, and the restart works fine. A listening
socket with no connections through it releases its port the moment the process dies.

What actually holds the port is a *connection*, not a listener. When a TCP connection
closes, the endpoint that closed **first** parks in `TIME_WAIT` for a couple of minutes,
holding its (address, port) pair so that stray packets from the dead connection can't be
delivered into a fresh one that happens to reuse the same numbers. If your server closed
a client's connection before it died, the server's own port is what's sitting in
`TIME_WAIT`, and the restart fails:

```
bind FAILED: Address already in use
```

So to reproduce it deliberately you need three things, in order: a client that connects,
a server that closes that connection, and only then a restart.

### SO_REUSEADDR, and the part nobody mentions

The fix is a socket option, set **before** `bind()` — it changes what `bind()` is
allowed to do, so setting it afterwards accomplishes nothing:

```cpp
int yes = 1;
setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
```

Now the part that will otherwise waste an hour of your evening. On Linux, **both** the
lingering `TIME_WAIT` socket and the new one have to carry `SO_REUSEADDR` for the bind
to be allowed. The connection your server accepted inherits its options from the
listening socket it came from — so the flag on the `TIME_WAIT` socket is whatever the
*previous run* of your server had set.

The consequence is genuinely confusing the first time: you hit `EADDRINUSE`, you add
`SO_REUSEADDR`, you rebuild, you restart — and it fails again, because the socket
holding the port was created by the old binary that didn't set it. Run it once more and
it works, and will keep working forever after. Verified, on this exact question:

| Previous run set `SO_REUSEADDR`? | Restart *with* `SO_REUSEADDR` |
| --- | --- |
| no | `EADDRINUSE` — still refused |
| yes | binds immediately |

There's one more case where the option can't save you at all. If the *client* never
closed its end, the connection isn't in `TIME_WAIT` — it's in `FIN_WAIT2`, which is a
live connection still waiting on the other side's FIN, not a lingering corpse.
`SO_REUSEADDR` only forgives `TIME_WAIT`. A half-closed connection holds the port until
the client goes away or `tcp_fin_timeout` (60 seconds, by default) expires.

### The one letter that changes everything

`SO_REUSEADDR` has a near-twin: **`SO_REUSEPORT`**, added in Linux 3.9 (2013), and it
does something completely different despite the almost identical name. It lets *multiple
separate sockets — in multiple separate processes —* bind the exact same port
simultaneously, and has the kernel load-balance incoming connections across them by
hashing each connection's four-tuple.

That is a genuinely big deal. It's how you scale an accept loop across CPU cores without
a single thread doing all the accepting and handing work off: run N identical processes,
each with its own listening socket on port 80, and the kernel distributes the
connections. NGINX, HAProxy and Envoy all have a flag for it. It also enables
zero-downtime restarts — the new process binds the same port before the old one exits,
so no connection is ever refused in the gap.

You don't need it for this milestone. You should know it's one letter away from the
option you *are* using.

### Go and look at the listening socket

Once `listen()` has run, the socket is visible from outside your process:

```console
$ ss -ltn
State    Recv-Q   Send-Q   Local Address:Port   Peer Address:Port
LISTEN   0        128            0.0.0.0:9000        0.0.0.0:*
```

`ss` is the modern replacement for `netstat` (same information, reads
`/proc/net/tcp` far more efficiently). `-l` is listening sockets, `-t` is TCP, `-n`
skips DNS resolution so you see numbers instead of hostnames.

On a `LISTEN` row those two queue columns are repurposed and worth knowing: **`Recv-Q`
is the number of connections currently sitting in the accept queue waiting for you**,
and **`Send-Q` is the backlog you actually got** — the clamped value, not the number you
passed. That's how you check what `somaxconn` did to your argument without guessing.

`0.0.0.0` in the local address is `INADDR_ANY` from Day 2, printed back at you.

## Task

Extend Day 2's program:

1. `bind()` the socket to the `sockaddr_in` you built yesterday. Cast to `sockaddr *`
   and pass `sizeof(addr)` — Day 2's `sin_zero` discussion is what makes that cast safe.
2. `listen()` on it, with a backlog of your choosing.
3. Check both return values properly and print `strerror(errno)` on failure.
4. Then keep the process alive — a `std::getchar()` is fine — so the socket stays in
   `LISTEN` while you go and look at it.

Now the two experiments, which are the actual point of today:

**Break it on purpose.** With the server running, open another terminal and run
`ss -ltn`. Find your socket. Note what `Send-Q` says versus the backlog number you
passed.

Now reproduce `EADDRINUSE` properly — and note that just killing and restarting a
server that never had a client will *not* do it. You need a connection that your server
closed:

```console
$ nc 127.0.0.1 9000          # connect, then Ctrl-C after a second
```

Have your server `accept()` it and `close()` it (a temporary two lines — you'll write
`accept()` properly tomorrow), then kill the server and restart immediately. That should
fail. Confirm the port is genuinely still held:

```console
$ ss -tan | grep 9000        # look for TIME_WAIT
```

If `ss` isn't installed, `/proc/net/tcp` has the same information in hex — state `06`
is `TIME_WAIT`, and the port is the half after the colon in the local address column
(9000 is `2328`).

Then add `SO_REUSEADDR` before `bind()`. Expect the *first* restart after adding it to
still fail, for the reason in the theory above, and the one after that to work.

**Watch the backlog fill.** Do not call `accept()` (you don't have it yet — that's
tomorrow). With the server sitting in `listen()`, connect to it several times from
another terminal:

```console
$ for i in $(seq 1 5); do nc -z 127.0.0.1 9000 & done
```

Then run `ss -ltn` again and look at `Recv-Q`. Those are completed connections the
kernel handshook for you, waiting in the accept queue, for a program that has never
called `accept()`. That number is the theory above made visible.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day3 src/main.cpp`
- You'll need `<sys/socket.h>` for `setsockopt`, alongside Day 2's includes

### Checklist

- [ ] `bind()` called with the `sockaddr *` cast and an explicit length, return checked
- [ ] `listen()` called, return checked
- [ ] reproduced `EADDRINUSE` deliberately by restarting immediately
- [ ] `SO_REUSEADDR` set *before* `bind()`, and the restart now succeeds
- [ ] found the socket in `ss -ltn`, and compared `Send-Q` to the backlog you passed
- [ ] saw `Recv-Q` rise with connections you never accepted
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. The backlog argument to `listen()` is the depth of a queue. A queue of *what*,
   exactly — and who puts things in it?
2. You call `listen(fd, 4096)` and it returns 0. Why might your actual backlog be far
   smaller than 4096, and how would you find out what you really got?
3. Nothing is running on port 9000, but `bind()` fails with `EADDRINUSE`. What is
   holding the port, and why does that mechanism exist at all?
4. You hit `EADDRINUSE`, add `SO_REUSEADDR`, rebuild, and restart — and it fails
   *again*. The next restart works. What happened?
5. `SO_REUSEPORT` is one letter different from `SO_REUSEADDR` and does something
   entirely different. What does it let you do that `SO_REUSEADDR` does not?
