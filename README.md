# pfun
PFun is a procedural-functional language with type inference and a memoized lazy functional subset with a strictly-executed procedural wrapper.

This is still super early days. No exceptions or even error handling, missing core language features, and syntax that is subject to change.

Some key features:

* Memoized to store results of previously calculated function values. Good for repeated large calculations.
* Functions themselves are purely functional with lazy evaluation and immutable let declarations.
* Some syntax like procedures, eval, print, and mutable var declarations force strict evaluation. Procedures can run functions, but not vice versa.
* Immutable lists with recursion (tail call optimized), list management functions (cons, head, tail), and higher order functions. 
* Algebraic data types with record types and discriminated unions. Match expressions with guards allow easy traversal

example.pf contains sample code demonstrating language operation.

## Setup
npm init -y
npm install --save-dev typescript

## Test
npm run build
npm test

## Run
npm start \[filename.pf\]
