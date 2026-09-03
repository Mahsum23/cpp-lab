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
$ strace -e trace=network -f ./server
```

`strace` intercepts every syscall a process makes and prints it with its arguments and
return value. `-e trace=network` filters to the socket family; `-f` follows forks.

You'll see exactly the sequence you wrote, and — this is the useful part — the arguments
the kernel actually received, including the ones your constants expanded to:

```
socket(AF_INET, SOCK_STREAM, IPPROTO_IP)   = 3
bind(3, {sa_family=AF_INET, sin_port=htons(9000), sin_addr=inet_addr("0.0.0.0")}, 16) = 0
listen(3, 4096)                            = 0
accept(3, {sa_family=AF_INET, sin_port=htons(51234), ...}, [16]) = 4
recvfrom(4, "hello\n", 1024, 0, NULL, NULL) = 6
sendto(4, "hello\n", 6, 0, NULL, NULL)     = 6
close(4)                                   = 0
```

Read that listing against your own source and several days of theory become concrete at
once: the listening fd is 3 and the accepted fd is 4 (Day 4); `bind()` really did get 16
bytes, the size of `sockaddr_in` (Day 2); `recvfrom` returned 6 for a 6-byte line even
though you asked for 1024 (Day 5).

`strace` is also the fastest way to answer "why is my program stuck" — attach with
`strace -p <pid>` and the last line is what it's blocked in.

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

If `ss` isn't installed, `/proc/net/tcp` has all of it in hex, which is where `ss` reads
from anyway. States are numeric: `01` ESTABLISHED, `06` TIME_WAIT, `08` CLOSE_WAIT, `0A`
LISTEN. Ports are hex too — 9000 is `2328`.

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

**Observe.** Four things to see with your own eyes:

1. `strace -e trace=network ./server`, then connect a client. Read the syscall listing
   against your source and confirm the fd numbers, the `sockaddr_in` size, and a `recv`
   that returned less than you asked for.
2. `ss -tan | grep 9000` with a client connected — find the `LISTEN` and `ESTAB` rows
   from Day 4 again.
3. Kill the server after a client has connected and disconnected. Find the port in
   `TIME_WAIT`, then confirm it's gone about a minute later.
4. `ss -tin` on a live connection. Find the RTT and congestion window.

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
- [ ] found `LISTEN` and `ESTAB` rows for port 9000 simultaneously
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
