# Goroutines and channels

## Theory

This is the day Go earns its reputation. Concurrency is not a library here — it is
syntax, it is cheap enough to be boring, and the runtime will tell you when you have
deadlocked.

### `go` in front of a call, and that's it

```go order
done := make(chan string)
go func() {
	done <- "worker finished"
}()
fmt.Println(<-done)
```

```
worker finished
```

`go f()` runs `f` concurrently and returns immediately. The thing that starts is a
**goroutine**, and it is not an OS thread. The Go runtime multiplexes many goroutines
onto a small pool of real threads — an **M:N scheduler** — so the cost of starting one is
an allocation, not a system call.

How cheap, concretely? Start a hundred thousand of them and ask the runtime what it is
holding:

```
goroutines: 100001
total stack in use: 200352 KB, per goroutine: ~2051 bytes
OS threads in use: 4
```

**About 2 KB each**, one hundred thousand of them alive at once, running on four OS
threads. A pthread's default stack is 8 MB of reserved address space — four thousand
times more — which is why C and C++ servers grew thread pools, work queues, and eventually
`epoll` loops with hand-rolled state machines. Go's answer is "just start a goroutine per
connection", and at these numbers that is a real answer rather than a naive one.

The stacks start small and **grow**: the runtime allocates 2 KB, and when a function
would overflow it, it allocates a bigger stack, copies the frames across and fixes up the
pointers. You cannot do that in C, where a pointer to a local must stay valid at a fixed
address — which is exactly why C stacks must be reserved large and up front.

### Channels: a typed pipe with a lock built in

```go
ch := make(chan int)      // unbuffered
ch := make(chan int, 10)  // buffered, capacity 10
ch <- 42                  // send
v := <-ch                 // receive
close(ch)                 // no more sends
```

An **unbuffered** channel is a rendezvous: the sender blocks until a receiver is ready,
and vice versa. That blocking is a synchronisation primitive — you get "handoff happened"
for free, without a mutex or a condition variable. A **buffered** channel lets the sender
run ahead until the buffer fills.

Receiving has a two-value form that tells you whether the channel is closed, and `range`
over a channel loops until it is:

```go order
ch := make(chan int, 3)
ch <- 1
close(ch)
v, ok := <-ch
fmt.Println(v, ok)
```

Reading from a closed channel yields the zero value with `ok == false` — it does not
block and does not panic. *Sending* to a closed channel panics, which is why the rule is
that **the sender closes**, never the receiver.

> [!NOTE]
> **"Don't communicate by sharing memory; share memory by communicating."** The most
> quoted Go proverb, and it is doing more work than it looks. The usual model is a shared
> variable plus a mutex, where the data sits still and the ownership is implied by whoever
> holds the lock. The channel model passes the *data* between goroutines, so at any moment
> exactly one of them has it, and ownership is a fact rather than a convention. It is not
> a rule that you must never use a mutex — the standard library is full of them, and
> `sync.Mutex` is often the simpler answer for guarding one counter. It is a claim about
> which model to reach for first.

### The runtime notices when everyone is asleep

```go
func main() {
	ch := make(chan int)
	<-ch
}
```

```
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan receive]:
main.main()
	/path/dead.go:5 +0x25
exit status 2
```

Nothing can ever send on that channel, so nothing can ever wake `main`. The scheduler
notices that *every* goroutine is blocked, declares deadlock, and prints where each one is
stuck. Anyone who has attached gdb to a hung C++ process to work out which thread is
holding what will appreciate getting this for free.

The honest caveat: it only fires when **all** goroutines are asleep. One goroutine stuck
forever while the rest of the program hums along is not a deadlock the runtime can detect,
and that is the most common real leak in production Go — a goroutine blocked on a channel
nobody will ever write to, holding its stack and everything it references, forever.

### Waiting for a group of them

```go order
var wg sync.WaitGroup
wg.Add(1)
go func() {
	defer wg.Done()
	fmt.Println("working")
}()
wg.Wait()
```

`Add` before you start, `Done` on the way out — via `defer`, so a panic still counts —
and `Wait` blocks until the counter hits zero.

### The race detector, which you should just use

Concurrency bugs are not deterministic, which is what makes them awful. Here is a thousand
goroutines each doing `total++`:

```
total: 963
total: 985
total: 953
```

Three runs, three wrong answers, no crash, no error. `total++` is read-modify-write, and
the increments interleave. Now build with `-race`:

```
$ go run -race race.go
==================
WARNING: DATA RACE
Read at 0x00c00009a078 by goroutine 10:
  main.main.func1()
      race.go:15 +0x84

Previous write at 0x00c00009a078 by goroutine 7:
  main.main.func1()
      race.go:15 +0x96
```

It names the address, both goroutines, and both source lines. It is not a static check —
it instruments memory access at runtime and only reports races that actually happen, so it
finds nothing in code you don't exercise. Run your tests with `-race` in CI and you will
catch things that would otherwise surface once a month in production. It is not free — on a lock-heavy
loop doing 1.6 million increments, the same binary took 107 ms normally and 750 ms under
`-race`, about **7x** — which is why it is a flag rather than the default. Measure it on
your own workload before assuming a number; the overhead tracks how much memory traffic
you do, not how long the program runs.

The fixes here are a `sync.Mutex` around the increment, `atomic.AddInt64`, or having each
goroutine send its result down a channel and summing in one place.

## Quiz

1. What is a goroutine, and how does it differ from an OS thread in cost and in what
   schedules it?
2. What is the difference between an unbuffered and a buffered channel, and what
   synchronisation do you get for free from an unbuffered one?
3. Who is supposed to close a channel, and what happens if you send on a closed one?
4. Go reports `all goroutines are asleep - deadlock!`. What condition triggers that, and
   which very common concurrency bug does it NOT catch?
5. A program with 1000 goroutines doing `total++` prints a different wrong number each
   run and never crashes. What is happening, and what tool finds it?

## Task

Start some goroutines, then break them on purpose.

1. Start a goroutine that sends a string down a channel, and receive it in `main`. Then
   delete the receive and observe what happens to the goroutine's output — this is the
   "main exits and takes everyone with it" lesson.
2. Start ten goroutines that each send a number, and collect all ten. Use a
   `sync.WaitGroup` for a version that doesn't send anything back.
3. Cause a deadlock deliberately — receive from a channel nobody sends to — and record
   the runtime's message.
4. Write the counter race: N goroutines incrementing one shared variable. Run it several
   times and record the different answers.
5. Run the same program with `go run -race` and record what it tells you.
6. Fix it twice: once with a `sync.Mutex`, once by having each goroutine send its
   contribution down a channel. Note which one you find easier to read.

- File: `go/day06/concurrent.go`
- Run: `go run -race go/day06/concurrent.go`

### Checklist

- [ ] a goroutine's result received over a channel
- [ ] a `sync.WaitGroup` used to wait for several goroutines
- [ ] a deliberate deadlock triggered and the runtime's message recorded
- [ ] the counter race reproduced, with at least three different wrong totals recorded
- [ ] `-race` output captured, naming both conflicting lines
- [ ] the race fixed two different ways
