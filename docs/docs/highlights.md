---
sidebar_position: 0
title: Bagel By Example
---

> This is just a whirlwind tour of what Bagel's all about, for people who are
> curious. If you're ready to download it and get started, head to the Getting
> Started guide!

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

    // the final expression
    pi * diameter
)
```

Bagel functions can't modify variables or have other side-effects, but
procedures can:

```bagel
proc logGreeting(name: string) {
    const greeting = greet(name);
    log(greeting);
}
```

Variables can be defined at the module level, or within a procedure:

```bagel
let counter = 0

proc doThing() {
    counter += 1;
    log('called ${counter} times!');
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
const x: number = 'foo'
```

```
type error: type 'foo' is not assignable to type number
```

But in some ways, it's a little smarter about it:

```bagel
const comparison = 2 + 2 == 3
```

```
type error: can't compare types 4 and 3 because they have no overlap
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

Bagel can figure out whether something matches a type at runtime:

```
type Person = {
    name: string,
    age: number,
    email: string
}

func getName(json: unknown): string? =>
    if json instanceof Person {
        json.name
    } else {
        nil
    }
```

## Markup syntax

Bagel has JSX-like syntax:

```bagel
func renderProfile(person: Person) =>
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

But instead of calling out to a specific framework like React, it generates
plain JSON data, which can then be passed to any library:

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

const myMarkup: ExpectedMarkup = renderProfile(person)
```

Official Preact integration is available, but integrations can be written for
other rendering libraries.

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

Bagel supports lazy iterators:

```bagel
const arr = [1, 2, 3, 4, 5, 6]
const big = arr.iter()
    .filter(n => n > 3)
    .collectArray()
```

This avoids cloning the array multiple times when chaining:

```bagel
const arr = [1, 2, 3, 4, 5, 6]
const newArr = arr.iter()
    .filter(n => n > 3)
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

## Plans

Instead of Promises, Bagel has Plans:

```bagel
const request: Plan<unknown> = fetch('/some_endpoint')
```

A Plan is like a Promise that hasn't been kicked off yet. That means you can
re-use the same Plan multiple times:

```bagel
const request: Plan<unknown> = fetch('/some_endpoint')  // no request has been sent yet

async proc getResults() {
    const result1 = await request;  // request sent once
    const result2 = await request;  // request sent again
}
```

Functions can't execute Plans, they can only create them to be executed
elsewhere:

```bagel
func requestUser(id: string): Plan<User> =>
    fetch('/users?id=${id}')

async proc showUser1() {
    const request = requestUser('1');
    const user = await request;
    log(user);
}
```

## Reactivity

A fundamental problem when building certain kinds of apps, especially user
interfaces, is updating something when some variable changes. Bagel is unique by
supporting this at the language level.

In Bagel you can `autorun` a procedural block when a variable that's used in it
changes:

```bagel
let counter = 0

autorun {
    log(counter);
}
forever

proc main() {
    counter += 1;
    counter += 1;
    counter += 1;
}
```

```
1
2
3
```

We might update a UI in the same way:

```bagel
let list: string[] = []

proc addItem(item: string) {
    list.push(item);
}

function renderList(list: string[]) =>
    <ul>
        {list.iter()
            .map((item: string) =>
                <li>{item}</li>)
            .collectArray()}
    </ul>

autorun {
    // render this VDOM in the document <body>
    render(renderList(list));
}
forever
```

Every variable referenced will be tracked automatically. Any changes to it will
trigger all reactions it's involved in.

Reactivity can also be used for caching:

```
let users = [
    { name: 'Bob', age: 21 },
    { name: 'Betty', age: 65 },
    { name: 'Sarah', age: 34 },
]

@memo
func maximumAge(): number => users.iter()
    .map(user => user.age)
    .reduce(0, (maxAge, currentAge) => max(maxAge, currentAge))
```

Here, if `maximumAge()` is called multiple times in a row, the result will only
be computed once and re-used. But, if an element is added to or removed from the
`users` array or if one of the users' `age` properties is modified, the cached
result will automatically be invalidated. The next call to `maximumAge()` would
then re-compute the new result and cache it again.

> `@memo` is a "decorator"; there are other decorators, and you can write your
> own, but this one just happens to be a uniquely special part of the language!
