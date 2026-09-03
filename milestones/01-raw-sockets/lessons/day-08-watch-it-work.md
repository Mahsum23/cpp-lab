# Day 8 — Watch it work

## Theory

### Two halves: rigor, and finally seeing it

No new syscalls today. This session is the difference between code that works on your
machine and code you'd defend in a review — and then the part that makes every claim
from Day 1 onward something you have *observed* rather than something you were told.

The observability half matters more than it sounds. The distinguishing habit of a senior
engineer here isn't knowing more syscalls; it's refusing to guess. "The connection is
probably still open" and "it's probably a firewall" are things a junior says. The tools
below turn all of those into two seconds of looking.

### strace: your own syscalls, in order

```console
$ strace -f -e trace=network ./server
```

`strace` intercepts every syscall a process makes and prints it with its arguments and
return value. `-e trace=network` filters to the socket family; `-f` follows forks.

Here is the real output from a one-shot echo server, with a client connecting and
sending `hello`:

```
socket(AF_INET, SOCK_STREAM, IPPROTO_IP) = 3
setsockopt(3, SOL_SOCKET, SO_REUSEADDR, [1], 4) = 0
bind(3, {sa_family=AF_INET, sin_port=htons(9401), sin_addr=inet_addr("0.0.0.0")}, 16) = 0
listen(3, 4096)                   = 0
accept(3, NULL, NULL)             = 4
recvfrom(4, "hello\n", 1024, 0, NULL, NULL) = 6
sendto(4, "hello\n", 6, 0, NULL, 0) = 6
+++ exited with 0 +++
```

Read that against your own source and most of this week turns concrete at once:

- **the listening fd is 3, the accepted fd is 4** — Day 4's two-fds rule, in the return
  values
- **`bind()` really did get 16 bytes** — Day 2's `sizeof(sockaddr_in)`, and `strace`
  has decoded the struct back into `htons(9401)` and `0.0.0.0` for you
- **`setsockopt` shows `[1], 4`** — Day 3's `int yes = 1` and its length, which is what
  that `void *` plus length actually carried
- **`recvfrom` returned 6 for a 1024-byte buffer** — Day 5's short read, in one line
- **there is no `close()` in this listing**, even though the program closes both
  sockets. `close` is not a network syscall, so `-e trace=network` filters it out.
  When a filter hides something you expected, that's the filter, not the program —
  drop `-e` entirely and you'll see all several hundred calls, most of them the dynamic
  linker starting up.

Also note `recv()` appears as `recvfrom` and `send()` as `sendto`. Those are the real
syscalls; the simpler names are thin library wrappers that pass `NULL` for the address
arguments, which is exactly what you can see them doing here.

### Two flags worth knowing

**`-T` prints how long each call took**, in seconds, at the end of the line:

```
accept(3, NULL, NULL)             = 4 <1.997963>
recvfrom(4, "hi\n", 1024, 0, NULL, NULL) = 3 <0.000028>
```

The client connected two seconds after the server started, and there it is: `accept()`
blocked for 1.99 seconds, `recvfrom()` took 28 microseconds. That's Day 4's claim —
blocking is a sleep, not a spin — as a measurement rather than an assertion. It's also
the fastest way to find which call in a slow request is actually the slow one.

**`-c` replaces the listing with a summary table**, counting every syscall and totalling
its time:

```
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ----------------
  0.00    0.000000           0         4           close
  0.00    0.000000           0         1           socket
  0.00    0.000000           0         1           accept
  0.00    0.000000           0         1           sendto
```

Useless on a program this small, and the first thing to reach for on a server that
"feels slow" — a process making a hundred thousand `recvfrom` calls a second, or one
accumulating `errors`, shows up here immediately and nowhere else.

**Attaching to something already running** is the other everyday use:

```console
$ strace -p <pid>              # attach; Ctrl-C to detach, the process keeps running
```

### ss: the connections, from outside

```console
$ ss -tan                     # all TCP sockets, numeric
$ ss -tan state time-wait     # just the lingering ones
$ ss -tanp                    # add the owning process (needs privileges)
$ ss -tin                     # add per-connection TCP internals: rtt, cwnd, retransmits
```

`ss -tin` is the one most people never try. It prints the congestion window, smoothed
round-trip time, and retransmission counts *per connection* — the actual state of the TCP
state machine Day 1 claimed was in there, available to look at any time.

### Reading /proc/net/tcp directly

`ss` reads `/proc/net/tcp`, and on a stripped-down box (a container, a rescue shell)
that file may be all you have. It's worth being able to read it unaided, because it also
shows you that none of this is magic — the kernel simply publishes its connection table
as text:

```console
$ cat /proc/net/tcp
  sl  local_address rem_address   st tx_queue:rx_queue ...
   0: 00000000:2455 00000000:0000 0A 00000000:00000000 ...
```

Everything is hex, and the addresses are little-endian byte-reversed (Day 2's byte
order, showing up in an unexpected place):

| Field | Meaning |
| --- | --- |
| `local_address` | `IP:port`, both hex. Port `2455` is 9301; `00000000` as the IP is `0.0.0.0` |
| `st` | state. `01` ESTABLISHED, `06` TIME_WAIT, `08` CLOSE_WAIT, `0A` LISTEN |
| `tx_queue:rx_queue` | bytes waiting in the send and receive buffers, hex |

That last column is the one worth knowing about, because it makes Day 5 and Day 6
visible in the same line. Here is a real capture: a client sent 200,000 bytes to a
server that accepted the connection and then deliberately never called `recv()`.

```
local=2455 remote=0000 state=0A queues(tx:rx)=00000000:00000000   <- the listener
local=C35A remote=2455 state=01 queues(tx:rx)=00012540:00000000   <- the client
local=2455 remote=C35A state=01 queues(tx:rx)=00000000:0001E800   <- the server
```

`0x1E800` is 124,928 and `0x12540` is 75,072. Two things fall out of that:

1. **124,928 bytes are sitting in the server's receive queue** for a process that has
   never read a byte. That's Day 5's "the kernel's buffer is not your buffer", measured.
2. **75,072 bytes are stuck in the client's send queue**, because the server's receive
   buffer filled up and TCP flow control stopped the client from sending more. That's
   the backpressure behind Day 6's short writes — the client's `send()` can't complete
   because the receiver isn't draining.

And they add up: 124,928 + 75,072 = 200,000, exactly what was sent. Every byte is
accounted for in one queue or the other, and none of it has reached application code.

### Answering the question Day 3 left open

Day 3 had you reproduce `EADDRINUSE`, fix it with `SO_REUSEADDR`, and deliberately left
*why* unexplained. Here it is.

When a TCP connection closes, the endpoint that closed **first** enters `TIME_WAIT` and
stays there for twice the maximum segment lifetime — 60 seconds on Linux. It is holding
its (address, port) pair on purpose, and it's protecting against two things:

1. **Stray duplicates.** A connection is identified only by its four-tuple. A delayed
   packet from the old connection, arriving after you've bound a new one with the same
   four numbers, would be indistinguishable from legitimate new data. `TIME_WAIT` keeps
   the tuple reserved until anything still wandering the network has expired.
2. **A reliable final handshake.** The closing side's last ACK might be lost. If it is,
   the peer retransmits its FIN, and someone has to be there to answer — that's the
   `TIME_WAIT` socket's other job. Vanish immediately and the peer gets an RST and a
   confusing error instead of a clean close.

So `TIME_WAIT` is not a bug or a leak. It's a deliberate cooling-off period, and the
reason your server needed `SO_REUSEADDR` to restart promptly.

Now go and see it: run your server, connect and disconnect a client, kill the server,
and immediately look for the port in `TIME_WAIT`. Then watch it disappear about a minute
later.

### tcpdump: the actual packets

```console
$ sudo tcpdump -i lo -n 'port 9000'
```

This is the ground truth — the SYN, SYN-ACK, ACK of the handshake; the data segments;
the FIN and its ACK at the end; the RST when something goes wrong. Everything Days 3–7
described in prose, as lines of output.

Two practical notes: it usually needs root (packet capture is privileged), and on
loopback the interface is `lo`, not your ethernet device. If you can't install it or get
the privileges, you have not missed the core of today — `strace` and `ss` cover the
lesson. Wireshark is the same capture with a GUI and much better protocol decoding, and
it's worth an evening of curiosity at some point.

### The rigor half

Go back through both files and check the return value of **every** syscall: `socket`,
`setsockopt`, `bind`, `listen`, `accept`, `recv`, `send`, `close`, `connect`,
`shutdown`, `inet_pton`. On failure, print `strerror(errno)` and exit non-zero.

Yes, `close()` too. It can fail, and the failure means data may have been lost.

Then compile both with `-Wall -Wextra` and fix every warning — no exceptions, no "that
one's harmless". If Days 1–7 were done properly, this should be a quiet session; if it
isn't, that's a `TODO` you skipped, and finding it now is the point.

Two habits worth taking to milestone 02: `-fsanitize=address,undefined` catches buffer
mistakes that `-Wall` can't see, and is free to enable on a debug build. And
`-Wconversion` will complain about the `ssize_t`-to-`size_t` narrowing that socket code
is full of — it's noisy, but it finds real bugs in exactly this kind of code.

## Task

**Harden.** Every syscall in `server.cpp` and `client.cpp` checked, `strerror(errno)` on
failure, non-zero exit. Zero warnings under `-Wall -Wextra`. Zero tolerance.

**Observe.** Six things to see with your own eyes:

1. `strace -f -e trace=network ./server`, then connect a client. Read the syscall
   listing against your source and confirm the fd numbers, the `sockaddr_in` size of
   16, and a `recvfrom` that returned less than you asked for.
2. Run it again with `-T`. Find how long your `accept()` sat blocked, and compare that
   to how long `recvfrom()` took once data was there.
3. `ss -tan | grep 9000` with a client connected — find the `LISTEN` and `ESTAB` rows
   from Day 4 again.
4. Make the queues move. Comment out your `recv()` so the server accepts and then
   ignores the client, send it a large blob
   (`head -c 200000 /dev/zero | tr '\0' 'x' | nc 127.0.0.1 9000`), and watch `Recv-Q`
   on the server's row climb while the client's `Send-Q` backs up. Add the two together
   and compare against what you sent. Put the `recv()` back afterwards.
5. Kill the server after a client has connected and disconnected. Find the port in
   `TIME_WAIT`, then confirm it's gone about a minute later.
6. `ss -tin` on a live connection. Find the RTT and congestion window.

Then, in your own words, write two or three sentences in `PROGRESS.md` answering: *why
was the port still busy, and what is `TIME_WAIT` protecting?* That's the note that turns
Day 3's workaround into understanding.

- Files: `src/server.cpp`, `src/client.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o server src/server.cpp && g++ -std=c++20 -Wall -Wextra -o client src/client.cpp`

### Checklist

- [ ] every syscall's return value checked in both files, `close()` included
- [ ] `strerror(errno)` printed and non-zero exit on every failure path
- [ ] zero warnings under `-Wall -Wextra` on both files
- [ ] read your own syscall sequence in `strace` and matched it to your source
- [ ] timed a blocked `accept()` with `strace -T`
- [ ] found `LISTEN` and `ESTAB` rows for port 9000 simultaneously
- [ ] watched `Recv-Q` and `Send-Q` fill with a server that wasn't reading, and
      accounted for every byte sent
- [ ] found the port in `TIME_WAIT` after a disconnect, and watched it expire
- [ ] wrote the `TIME_WAIT` explanation in `PROGRESS.md` in your own words

## Quiz

1. You attach `strace` to a server that appears hung. What single piece of information
   does the last line give you, and why is that usually enough?
2. `TIME_WAIT` holds a port for a minute after the connection closed. What two distinct
   problems is it preventing?
3. Which endpoint of a connection ends up in `TIME_WAIT`, and what does that imply about
   a server that closes connections itself?
4. `close()` can fail. What does a failure actually mean, and why is ignoring it worse
   than ignoring most errors?
5. You see `CLOSE_WAIT` connections piling up on your server and never going away. What
   does that state mean, and whose bug is it?
