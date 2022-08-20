---
sidebar_position: 0
title: Highlights
---

> This is just a whirlwind tour of what Bagel's all about, for people who are
curious. If you're ready to download it and get started, head to the Getting
Started guide!

## Basics

In Bagel you can define constants:

```bagel
const a = 12
const b = 'stuff'
const c = { prop: [1, 2, 3] }
```

You can also define functions:

```bagel
func double(n: number) => n * 2
```

A Bagel function's body can be any expression:

```bagel
func greet(name: string) =>
    if name == 'Brandon' {
        'Hello, Brandon!'
    } else {
        'You\'re not brandon!'
    }
```

A Bagel expression can have constants inside that get used along the way:

```bagel
const circumference = (
    const radius = 5,
    const diameter = radius * 2,
    const pi = 3.14159,
    pi * diameter
)
```

Bagel functions can't assign to variables or have other side-effects, but 
procedures can:

```bagel
proc logGreeting(name: string) {
    const greeting = greet(name);
    log(greeting);
}
```

Variables can be defined at the module level, or within a procedure:

```bagel
let numberOfCalls = 0

proc doThing() {
    numberOfCalls += 1;
    log('did the thing for the ${numberOfCalls}th time!');
}
```

But procedures can't return values:

```bagel
proc getThing() {
    return 2 + 2; // syntax error!
}
```

Only functions can:

```bagel
func getThing(): number => 2 + 2
```

## Types

Bagel is statically typed, like TypeScript:

```bagel
const x: number = 'foo'  // type error
```

But in some ways, it's a little smarter about it:

```bagel
const comparison = 2 + 2 == 3  // type error: can't compare types 4 and 3 because they have no overlap
```

Bagel values can be `nil`, but only if you say they can be:

```bagel
func maybeDouble(num: number?) =>
    if num == nil {
        nil
    } else {
        num * 2
    }
```

Bagel can figure out what type something is at runtime:

```
type Person = {
    name: string,
    age: number,
    email: string
}

func getName(jsonData: unknown): string? =>
    if jsonData instanceof Person {
        jsonData.name
    } else {
        nil
    }
```


## Markup syntax

Bagel has JSX-like syntax:

```bagel
func renderNameplate(person: Person) =>
    <div>
        <div>
            <span>Name: </span>
            <span>{person.name}</span>
        </div>
        <div>
            <span>Email: </span>
            <span>{person.email}</span>
        </div>
    </div>
```

But instead of calling out to a specific framework like React, it generates plain JSON data, which can then be passed to any library:

```bagel
type ExpectedMarkup = {
    tag: 'div',
    attributes: {},
    children: [
        {
            tag: 'div',
            attributes: {},
            children: [
                {
                    tag: 'span',
                    attributes: {},
                    children: [
                        string
                    ]
                },
                {
                    tag: 'span',
                    attributes: {},
                    children: [
                        string
                    ]
                }
            ]
        },
        {
            tag: 'div',
            attributes: {},
            children: [
                {
                    tag: 'span',
                    attributes: {},
                    children: [
                        string
                    ]
                },
                {
                    tag: 'span',
                    attributes: {},
                    children: [
                        string
                    ]
                }
            ]
        }
    ]
}

const myMarkup: ExpectedMarkup = renderNameplate(person)
```

Official Preact integration is available, but others can write integrations for
their rendering library of choice.

## JavaScript interaction

Bagel compiles to a single, minified JavaScript bundle:
```
bagel build my-project/index.bgl
```

This bundle can be targeted at web browsers, node, deno, or any combination of
the three:
```
<script src="my-project.bundle.js"></script>
```
```
node my-project.bundle.js
```
```
deno run my-project.bundle.js
```

JavaScript integrations are written in the form of funcs or procs:

```bagel
js proc log(val: unknown) {#
    console.log(val)
#}
```

```bagel
js func sqrt(num: number): number => {#
    return Math.sqrt(num)
#}
```

JS funcs or procs can be marked as platform-specific, to prevent them from being
called in builds that target a different platform:

```bagel
deno func cwd(): string => {#
    return Deno.cwd()
#}
```

## Iterators

Bagel supports iterators:

```bagel
const arr = [1, 2, 3, 4]
const big = arr.iter().filter(n => n > 2).collectArray()
```

This avoids cloning several arrays when chaining:

```bagel
const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const newArr = arr.iter()
    .filter(n => n > 5)
    .map((n: number) => n + 100)
    .slice(20, 40)
    .collectArray()
```

It also allows us to have a range operator:

```bagel
const nums: number[] = 0..1000.collectArray()
```

Iterators can also be used in for-loops:

```bagel
proc printNumsUntil(end: number) {
    for n of 0..end {
        log(n);
    }
}
```

## Reactivity