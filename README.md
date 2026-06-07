# Pfun

The seed of the idea for Pfun came from using REPLs for functional languages such as Haskell. If you’re not familiar with them, REPLs (Read-Eval-Print Loops) allow you to type in calculations, functions, and so forth right at the command line and immediately see the result. Pure functional code doesn’t have side effects (unless handled in a special way, such as monads in Haskell), and it’s easy to write pure side-effect-free code in a REPL. But the thing is, in a REPL, you type in the code and the first thing that happens is that it has a side effect – it evaluates the code and prints the result. It’s a reminder that while pure functional code with no side effects has useful properties, it’s meaningless without being able to do something with the results, even if that’s simply displaying it to the user.

This idea – of side-effect-free functional code with a wrapper like a REPL around it – is what Pfun is built around.  PFun is a procedural-functional language. The core of the language is a lazy, pure functional language with no side effects. It’s built around functions, lists, and algebraic data types. There's a REPL that allows you to just use this language core. But there’s also a procedural subset of the language you can use to “wrap around” the functional core.

Going beyond just printing results, you can do things like use procedural code to take in data from a variety of sources such as web APIs, a database, or user console input, process it using pure functional tools, and then use procedural code to save the result to a file, a database, or a cloud data store.

The procedural portion of the language provides imperative tools like procedures, mutable variables, dictionaries and arraylists, file and console I/O, and network access. But it doesn’t allow them to be used inside functional code. Some impure functional languages are designed for programmers to reason about where it makes sense to place impure code. Pfun is instead designed around the guarantee that if you call functional code, there will never be side effects in that code.

Finally, while Pfun supports procedural code, it doesn't support object-oriented code. Instead of using methods on objects, functions perform operations on algebraic data types. This was a deliberate choice, based on the belief that pure functional operations aren't necessarily a good fit with most object models, even in languages where this juxtaposition has been forced by the the need to interoperate with libraries and virtual machines build for object oriented systems.

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
