const None = {$t: "None", $u: "Maybe", f: []};
function Some(value) {
  return {$t: "Some", $u: "Maybe", f: [value]};
}
function add(x, y) {
  return $addI(x, y);
}
const message = $strConcat("answer=", $stringify(add(2, 3)));
