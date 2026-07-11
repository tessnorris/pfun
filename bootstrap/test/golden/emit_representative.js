const None = {$t: "None", $u: "Maybe", f: []};
function Some(value) {
  return {$t: "Some", $u: "Maybe", f: [value]};
}
function add(x, y) {
  return $addI(x, y);
}
const message = $concatS("answer=", $str(add(2, 3)));
