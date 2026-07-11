const values = [1, 2, 3];
function sum(xs) {
  let total = 0;
  let i = 0;
  loop: {
    while (i < xs.length) {
      if (xs[i] < 0) {
        i = i + 1;
        continue;
      } else {
        total = total + xs[i];
      }
      if (total > 100) {
        break;
      }
      i = i + 1;
    }
  }
  return total;
}
try {
  const result = sum(values);
  console.log(result);
} catch (error) {
  throw error;
}
