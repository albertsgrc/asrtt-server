exports.timeToString = function(ms, pretty = false) {
  let left = ms;
  const hours = Math.floor(left / 3600000);
  left %= 3600000;
  const minutes = Math.floor(left / 60000);
  left %= 60000;
  const seconds = Math.floor(left / 1000);

  const space = pretty ? " " : "";

  let s = `${hours}h${space}${minutes}m${space}${seconds}s`;

  return s;
};
