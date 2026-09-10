# Zero values, and the walrus that bites

## Theory

Yesterday was the toolchain. Today is the part of Go you will type a thousand times:
declaring things. It is a small topic with two genuinely sharp edges in it.

### There is no uninitialised memory

```go
var i int
var s string
var p *int
fmt.Printf("int=%d string=%q ptr=%v\n", i, s, p)
```

```
int=0 string="" ptr=<nil>
```

Every type in Go has a **zero value**, and every declaration without an initialiser gets
it. Numbers are `0`, strings are `""`, booleans are `false`, pointers and slices and maps
and interfaces are `nil`. Structs are a struct of zero values, all the way down:

```
struct={X:0 Y:0}
slice=[] len=0
```

If you have written C or C++, stop and appreciate how much this deletes. `int i;` at
block scope in C is *indeterminate* — reading it is undefined behaviour, and undefined
behaviour is not "you get a garbage number", it is "the optimiser may now assume this
line is unreachable and delete your bounds check". A decade of security advisories lives
in that gap. Go closes it by fiat: the value is always defined, and it always costs one
memory write you can't opt out of.

The design payoff is that zero values are chosen to be *useful*, not merely defined. A
`nil` slice has length 0 and you can `append` to it. A `sync.Mutex`'s zero value is an
unlocked mutex, so `var mu sync.Mutex` is ready to use with no constructor. Go has no
constructors at all, and this is why it can get away with that.

### Two ways to declare, and one of them is only for inside functions

```go
var count int = 42   // explicit type and value
var count = 42       // type inferred; still a var
count := 42          // short declaration — same thing, function bodies only
```

The `:=` form is universally nicknamed the walrus, and it is what you will write almost
everywhere. It declares *and* assigns, and infers the type. At package level you must use
`var`, because `:=` needs a function body to live in.

### The sharp edge: `:=` always declares something new

```go
count := 1
if true {
	count := 2 // a NEW variable that shadows the outer one
	_ = count
}
fmt.Println("outer count is", count)
```

```
outer count is 1
```

The inner `count` is a different variable that happens to share a name, and it dies at
the closing brace. The outer one was never touched. This is **shadowing**, it compiles
without a murmur, and it is the single most common way a Go program silently does nothing.

The version that actually bites in real code looks like this, because it does not even
have an obvious inner scope:

```go
data, err := load()
if err != nil { return err }

if needsRefresh {
	data, err := reload()      // both are new; the outer data is unchanged
	if err != nil { return err }
	_ = data
}
use(data)                      // still the old data. No warning, no error.
```

Note what saves you *sometimes*: if at least one variable on the left is new, `:=` will
**assign** to the existing ones rather than redeclare them — but only within the same
scope. Cross a brace and everything is new again. The fix is to use plain `=` when you
mean assignment, and to declare `err` once at the top of the function.

`go vet` does not catch this. Run `go tool vet help` and read the list of registered
analyzers — there are thirty-odd, checking everything from `Printf` argument types to
locks copied by value, and `shadow` is not among them. It exists, as a separate analyzer
you can attach with `go vet -vettool=...`, and it is kept out of the default set because
on idiomatic Go it fires constantly on shadowing that is entirely intentional. So this
one is on you, and knowing the shape of it is most of the defence.

### No implicit numeric conversions. None.

```go
var a int = 3
var b int64 = 4
fmt.Println(a + b)
```

```
./conv.go:8:14: invalid operation: a + b (mismatched types int and int64)
```

Even though `int` is 64 bits on this machine, `int` and `int64` are **different types**
and Go will not quietly bridge them. You write `a + int(b)` and mean it.

If you have fought C's integer promotions — where comparing a signed `int` with an
unsigned `size_t` silently converts one of them and your `i >= 0` loop guard becomes
permanently true — you will recognise what is being prevented here. C's conversion rules
are a lattice you have to memorise; Go's rule is one sentence: *there aren't any*. The
cost is `int(...)` noise in arithmetic that mixes widths. The benefit is that the noise
is exactly where the danger is.

### Worth knowing: constants are not values, and they are arbitrarily precise

```go order
const big = 1 << 62
const huge = big * 4
fmt.Println(float64(huge) / 1e18)
```

An untyped constant in Go is not stored in any machine type until it is used in a place
that needs one. It lives at arbitrary precision during compilation, so `huge` above is
`2^64` — a value that fits in no Go integer type at all — and only becomes a problem if
you try to put it in one. This is why `math.MaxUint64` can be written as a plain constant,
and why `const Pi = 3.14159265358979323846264338327950288419716939937510582097494459` is
legal and keeps every digit that the type you eventually assign it to can hold.

```
18.446744073709553
```

That is 2^64 divided by 10^18 — a constant larger than `uint64` can hold, computed
exactly and only then converted. Try to store it somewhere too small and the failure is
at compile time, not runtime:

```
./over.go:8:16: cannot use big (untyped int constant 4611686018427387904) as int32 value
in variable declaration (overflows)
```

Note that the compiler tells you the *value* it computed. That is an error message you
can only get from a language that does its constant arithmetic before choosing a type.

## Quiz

1. In Go, what is the value of `var count int` before you assign anything to it, and how
   does that differ from `int count;` inside a function in C?
2. Name two zero values that were deliberately chosen so the zero value is immediately
   usable, and say what you can do with them without initialising anything.
3. `count := 2` inside an `if` block, when `count` already exists outside it. What
   happens to the outer variable, and what is this mistake called?
4. Go refuses to compile `a + b` where `a` is `int` and `b` is `int64`, even on a machine
   where both are 64 bits wide. Why, and what class of C bug does that prevent?
5. Why can `const huge = (1 << 62) * 4` compile when no Go integer type can hold that
   value?

## Task

Prove the zero values and then get shadowed on purpose, so that the day you meet it in
real code you recognise the shape.

1. Declare one variable of each of these with `var` and no initialiser: an `int`, a
   `float64`, a `string`, a `bool`, a pointer, a slice, and a struct with two fields.
   Print them all with `%v` and the string with `%q` so you can see it is empty rather
   than absent.
2. Append to the `nil` slice without initialising it first, and print the result. It
   should work; be clear with yourself about why.
3. Write the shadowing trap: a variable set outside a block, reassigned with `:=` inside
   it, printed after. Then fix it so the outer variable really changes, and record what
   you changed.
4. Try to add an `int` to an `int64`. Record the exact error, then make it compile.
5. Declare a constant larger than `int64` can hold, use it in a `float64` expression, and
   then deliberately try to assign it to an `int32` and record that error too.

- File: `go/day02/values.go`
- Run: `go run go/day02/values.go`

### Checklist

- [ ] every zero value printed, including a struct and an empty-versus-absent string
- [ ] `append` to a `nil` slice observed working
- [ ] shadowing reproduced deliberately, then fixed, with the fix recorded
- [ ] the `mismatched types` error triggered and then resolved with an explicit conversion
- [ ] an over-large constant used successfully, then made to fail at compile time
