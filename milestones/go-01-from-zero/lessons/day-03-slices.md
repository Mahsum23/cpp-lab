# Slices are not arrays

## Theory

This is the day Go stops feeling obvious. Slices are the type you will use constantly,
they look like a dynamic array from any other language, and they have one behaviour that
will eventually cost you an afternoon. Better to spend twenty minutes on it now.

### An array is a value. A slice is a view.

Go has both, and they are different types with different behaviour.

```go order
a := [3]int{1, 2, 3}
b := a
b[0] = 99
fmt.Println("array a:", a, " b:", b)
```

```
array a: [1 2 3]  b: [99 2 3]
```

`[3]int` is an **array**: the length is part of the type, and assigning one **copies all
the elements**. `[3]int` and `[4]int` are as unrelated as `int` and `string`.

Now the same thing with a slice:

```go order
s := []int{1, 2, 3}
t := s
t[0] = 99
fmt.Println("slice s:", s, " t:", t)
```

```
slice s: [99 2 3]  t: [99 2 3]
```

Both changed. `[]int` — no number in the brackets — is a **slice**, and a slice is a
small three-word header:

```
┌──────────────┬────────┬────────┐
│ ptr to array │  len   │  cap   │
└──────────────┴────────┴────────┘
```

Copying a slice copies the *header*, not the elements. Both headers point at the same
backing array. If you know C++, a slice is close to a `std::span` — except that it also
owns its backing array in the eyes of the garbage collector, and it can grow.

**Almost every Go program uses slices and almost never uses arrays directly.** Arrays
mostly appear as the thing a slice points at, and as fixed-size buffers like `[32]byte`
for a hash.

### `len` is what's there, `cap` is what fits

```go order
var s []int
s = append(s, 1)
fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
```

`append` writes into spare capacity if there is any. When there isn't, it allocates a
bigger array, copies everything across, and returns a slice pointing at the new one.
Watch it happen:

```
len= 1 cap= 1  <- grew
len= 2 cap= 2  <- grew
len= 3 cap= 4  <- grew
len= 5 cap= 8  <- grew
len= 9 cap=16  <- grew
```

Doubling, and the same amortised-constant-time argument as `std::vector`. This is also
why `append` **returns** the slice and you must write `s = append(s, x)`: when it
reallocates, your old header is pointing at the abandoned array. Forgetting the
assignment is a beginner error, and one of the few places Go's strictness saves you for
free:

```
./noassign.go:7:2: append(s, 2) (value of type []int) is not used
```

Yesterday's rule about unused things, doing an honest day's work.

If you know roughly how many elements you'll have, say so and skip the copying:

```go
s := make([]int, 0, 1000)   // len 0, cap 1000
```

### The trap

Here is the one to actually remember. A sub-slice shares the original's backing array,
and it inherits capacity all the way to the end of it:

```go order
full := []int{1, 2, 3, 4, 5}
head := full[:2]
fmt.Printf("head=%v len=%d cap=%d\n", head, len(head), cap(head))
head = append(head, 99)
fmt.Println("full is now:", full)
```

```
head=[1 2] len=2 cap=5
full is now: [1 2 99 4 5]
```

Read that twice. `head` looks like a two-element slice, but its capacity is **5** — it can
see all the way to the end of `full`'s array. So `append` finds spare room, does not
allocate, and writes 99 straight over `full[2]`. A function that took `head` as a
parameter and appended to it just silently corrupted a slice it was never given.

The fix is a **three-index slice**, which sets the capacity explicitly:

```go order
full := []int{1, 2, 3, 4, 5}
head := full[:2:2]
fmt.Printf("head=%v len=%d cap=%d\n", head, len(head), cap(head))
head = append(head, 99)
fmt.Println("full is now:", full)
```

```
head=[1 2] len=2 cap=2
full is now: [1 2 3 4 5]
```

`full[:2:2]` means low 0, high 2, **max 2** — capacity 2. Now `append` has no room, must
allocate, and `full` is untouched. When you hand a sub-slice to code you don't control,
this is how you do it safely.

There is a C++ echo here worth noticing. Appending to a `std::vector` invalidates
iterators and pointers into it, and everyone learns that rule. Go's version is stranger:
`append` never invalidates anything — the old array stays alive as long as something
points at it, because the garbage collector says so — but it may or may not *share* with
what you had before, and which one you get depends on capacity. C++ makes the old view
invalid; Go makes it valid and possibly aliased, which is quieter and therefore worse to
debug.

### Worth knowing: a giant array can be kept alive by a tiny slice

Because a slice holds a pointer into a backing array, the whole array stays reachable
even if your slice covers three bytes of it:

```go
data, _ := os.ReadFile("500mb.log")   // 500 MB
firstLine := data[:60]                // still pins all 500 MB
```

Hold `firstLine` in a cache and you have leaked half a gigabyte — a leak in a garbage
collected language, which is not supposed to be a thing you can do. The standard fix is
to copy what you actually want out:

```go
firstLine := append([]byte(nil), data[:60]...)   // fresh array, 60 bytes
```

Since Go 1.21 the standard library ships `slices.Clone` for exactly this, and you can
watch the pin let go — clone a 5-byte head of a 41-byte array and the copy reports
`cap=8` instead of `cap=41`, because it is a genuinely new array. If you ever
wondered how a Go service leaks memory without a single missing `free`, this is the
most common answer, along with goroutines that never exit — which is Day 6's problem.

## Quiz

1. `a := [3]int{1,2,3}; b := a; b[0] = 99`. What is `a[0]` afterwards, and what if the
   two had been slices instead?
2. What are the three fields of a slice header, and which of them does copying a slice
   copy?
3. Why must you write `s = append(s, x)` rather than just `append(s, x)`?
4. `head := full[:2]` where `full` has 5 elements. What is `cap(head)`, and what does
   `append(head, 99)` do to `full`?
5. You read a 500 MB file and keep a 60-byte slice of it in a cache. How much memory stays
   reachable, and what is the fix?

## Task

Reproduce the trap. This is not a puzzle you should take on faith — it is far more
convincing when the numbers come out of your own terminal.

1. Make an array and a slice of the same three values. Assign each to a second variable,
   modify the second, print both. Record which one changed and satisfy yourself as to why.
2. Append to an empty slice in a loop, printing `len` and `cap` each time the capacity
   changes. Record the growth pattern.
3. Build the trap: a five-element slice, a two-element sub-slice, an append to the
   sub-slice, then print the original. Record `cap` of the sub-slice before appending —
   that number is the whole explanation.
4. Fix it with a three-index slice and show the original surviving unchanged.
5. Write a function `func addOne(s []int)` that appends to its parameter, call it with a
   sub-slice of a larger one, and see whether the caller's data survives. Then make it
   safe.

- File: `go/day03/slices.go`
- Run: `go run go/day03/slices.go`

### Checklist

- [ ] array copy versus slice share demonstrated side by side
- [ ] capacity growth pattern recorded from a real loop
- [ ] the aliasing trap reproduced, with the sub-slice's capacity recorded
- [ ] the three-index fix shown protecting the original
- [ ] a function observed corrupting its caller's slice, then made safe
