# Slice D3 — Node binary I/O and buffers

D3 extends D2's shared file-handle cursor with raw bytes, bulk byte lists, and
mutable buffers:

```text
readByte
readBytes
writeByte
writeBytes
readBuffer
writeBuffer
makeBuffer
makeStringBuffer
appendBuffer
appendChar
appendString
bufferLength
bufferToBytes
bufferToString
```

The example-facing buffer read is:

```text
readBuffer(handle, count, mode) -> Result<Buffer, Str>
```

It returns a new `ByteMode` or `CharMode` buffer containing up to `count` bytes.
End-of-file therefore produces an empty successful buffer rather than an `Eof`
variant. `readByte` and `readBytes` retain `ReadResult`, where a read beginning
at EOF returns `Eof` and a short final read returns `Ok` with the available
bytes.

## Shared cursor

Text and binary operations use D2's single byte cursor and pending-byte queue.
For example, `readByte`, `readChar`, and `readLine` can be mixed without losing
or duplicating data. UTF-8 character decoding consumes exactly the bytes that
belong to that character.

## Buffer modes

`BufferMode` is the nominal union whose cases are `ByteMode` and `CharMode`.

`ByteMode` supports `appendBuffer` and `bufferToBytes`.

`CharMode` supports `appendChar`, `appendString`, and `bufferToString`.

`bufferLength` reports the number of encoded bytes in either mode. A `CharMode`
buffer containing `β` therefore has length 2.

`writeBuffer` accepts either mode and writes its raw bytes.

## Byte literal spelling

Decimal byte literals use a plain `b` suffix, such as `222b`.

Hexadecimal byte literals require an underscore before the suffix, such as
`0xDE_b`. The underscore is required because `b` is itself a hexadecimal digit;
without it, `0xDEb` is parsed as an `Int`.

## Deferred file work

Directory enumeration, metadata, rename, touch, and watchers remain later Node
host work. Async and process functionality remain D4 and D5.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d3.sh
```
