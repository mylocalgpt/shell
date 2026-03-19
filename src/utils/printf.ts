/**
 * Format a string using printf-style format specifiers.
 *
 * Supports: %s, %d, %f, %x, %X, %o, %%, with width, precision, and flags.
 * Handles escape sequences: \n, \t, \\, \xHH, \0NNN.
 * Implements argument recycling: if more args than specifiers, repeats format.
 *
 * @param format - The format string
 * @param args - Arguments to substitute
 * @returns Formatted output string
 */
export function formatPrintf(format: string, args: string[]): string {
  const processedFormat = processEscapes(format);
  let output = '';
  let argIndex = 0;

  // Process format string, consuming args. If args remain, repeat.
  let hasSpecifiers = false;
  // Check if format has any specifiers
  for (let i = 0; i < processedFormat.length; i++) {
    if (
      processedFormat[i] === '%' &&
      i + 1 < processedFormat.length &&
      processedFormat[i + 1] !== '%'
    ) {
      hasSpecifiers = true;
      break;
    }
  }

  if (!hasSpecifiers) {
    // No arg-consuming specifiers, but still process %% -> %
    const result = applyFormat(processedFormat, args, argIndex);
    return result.output;
  }

  // Keep cycling through format string while we have args to consume
  do {
    const startArgIndex = argIndex;
    const result = applyFormat(processedFormat, args, argIndex);
    output += result.output;
    argIndex = result.nextArgIndex;

    // If no args were consumed, break to avoid infinite loop
    if (argIndex === startArgIndex) break;
  } while (argIndex < args.length);

  return output;
}

/**
 * Process escape sequences in a format string.
 */
function processEscapes(format: string): string {
  let result = '';
  let i = 0;

  while (i < format.length) {
    if (format[i] === '\\' && i + 1 < format.length) {
      const next = format[i + 1];
      switch (next) {
        case 'n':
          result += '\n';
          i += 2;
          break;
        case 't':
          result += '\t';
          i += 2;
          break;
        case 'r':
          result += '\r';
          i += 2;
          break;
        case '\\':
          result += '\\';
          i += 2;
          break;
        case 'a':
          result += '\x07';
          i += 2;
          break;
        case 'b':
          result += '\b';
          i += 2;
          break;
        case 'f':
          result += '\f';
          i += 2;
          break;
        case 'v':
          result += '\v';
          i += 2;
          break;
        case 'x': {
          // \xHH - hex escape
          const hex = format.slice(i + 2, i + 4);
          const code = Number.parseInt(hex, 16);
          if (!Number.isNaN(code)) {
            result += String.fromCharCode(code);
            i += 4;
          } else {
            result += '\\x';
            i += 2;
          }
          break;
        }
        case '0': {
          // \0NNN - octal escape
          let octal = '';
          let j = i + 2;
          while (j < format.length && j < i + 5 && format[j] >= '0' && format[j] <= '7') {
            octal += format[j];
            j++;
          }
          if (octal.length > 0) {
            const code = Number.parseInt(octal, 8);
            result += String.fromCharCode(code);
            i = j;
          } else {
            result += '\0';
            i += 2;
          }
          break;
        }
        default:
          result += '\\';
          result += next;
          i += 2;
          break;
      }
    } else {
      result += format[i];
      i++;
    }
  }

  return result;
}

interface FormatResult {
  output: string;
  nextArgIndex: number;
}

/**
 * Apply a single pass of the format string, consuming args starting at argIndex.
 */
function applyFormat(format: string, args: string[], argIndex: number): FormatResult {
  let output = '';
  let i = 0;
  let ai = argIndex;

  while (i < format.length) {
    if (format[i] !== '%') {
      output += format[i];
      i++;
      continue;
    }

    i++; // skip %
    if (i >= format.length) {
      output += '%';
      break;
    }

    // %% - literal percent
    if (format[i] === '%') {
      output += '%';
      i++;
      continue;
    }

    // Parse flags
    let leftAlign = false;
    let forceSign = false;
    let spaceSign = false;
    let zeroPad = false;

    let parsingFlags = true;
    while (parsingFlags && i < format.length) {
      switch (format[i]) {
        case '-':
          leftAlign = true;
          i++;
          break;
        case '+':
          forceSign = true;
          i++;
          break;
        case ' ':
          spaceSign = true;
          i++;
          break;
        case '0':
          zeroPad = true;
          i++;
          break;
        default:
          parsingFlags = false;
          break;
      }
    }

    // Parse width
    let width = 0;
    while (i < format.length && format[i] >= '0' && format[i] <= '9') {
      width = width * 10 + (format.charCodeAt(i) - 48);
      i++;
    }

    // Parse precision
    let precision = -1;
    if (i < format.length && format[i] === '.') {
      i++;
      precision = 0;
      while (i < format.length && format[i] >= '0' && format[i] <= '9') {
        precision = precision * 10 + (format.charCodeAt(i) - 48);
        i++;
      }
    }

    if (i >= format.length) {
      output += '%';
      break;
    }

    const specifier = format[i];
    i++;

    const arg = ai < args.length ? args[ai] : '';
    ai++;

    output += formatArg(specifier, arg, width, precision, leftAlign, forceSign, spaceSign, zeroPad);
  }

  return { output, nextArgIndex: ai };
}

/**
 * Format a single argument according to its specifier.
 */
function formatArg(
  specifier: string,
  arg: string,
  width: number,
  precision: number,
  leftAlign: boolean,
  forceSign: boolean,
  spaceSign: boolean,
  zeroPad: boolean,
): string {
  let result: string;

  switch (specifier) {
    case 's': {
      result = arg;
      if (precision >= 0 && result.length > precision) {
        result = result.slice(0, precision);
      }
      return padString(result, width, leftAlign, ' ');
    }
    case 'd': {
      const num = toInteger(arg);
      result = formatInteger(num, forceSign, spaceSign);
      if (precision >= 0 && precision > result.length) {
        // Precision for integers means minimum digits
        const sign = result[0] === '-' || result[0] === '+' || result[0] === ' ' ? result[0] : '';
        const digits = sign ? result.slice(1) : result;
        result = sign + padLeft(digits, precision, '0');
      }
      const padChar = zeroPad && !leftAlign ? '0' : ' ';
      if (zeroPad && !leftAlign && (result[0] === '-' || result[0] === '+' || result[0] === ' ')) {
        const sign = result[0];
        const digits = result.slice(1);
        const padded = padLeft(digits, width - 1, '0');
        return sign + padded;
      }
      return padString(result, width, leftAlign, padChar);
    }
    case 'f': {
      const num = toFloat(arg);
      const prec = precision >= 0 ? precision : 6;
      result = num.toFixed(prec);
      if (forceSign && num >= 0) {
        result = `+${result}`;
      } else if (spaceSign && num >= 0) {
        result = ` ${result}`;
      }
      const padChar = zeroPad && !leftAlign ? '0' : ' ';
      if (zeroPad && !leftAlign && (result[0] === '-' || result[0] === '+' || result[0] === ' ')) {
        const sign = result[0];
        const digits = result.slice(1);
        const padded = padLeft(digits, width - 1, '0');
        return sign + padded;
      }
      return padString(result, width, leftAlign, padChar);
    }
    case 'x':
    case 'X': {
      const num = toInteger(arg);
      const abs = num < 0 ? num >>> 0 : num;
      result = abs.toString(16);
      if (specifier === 'X') result = result.toUpperCase();
      if (num < 0 && !(num < 0 && num >>> 0 !== 0)) {
        result = `-${result}`;
      }
      return padString(result, width, leftAlign, zeroPad && !leftAlign ? '0' : ' ');
    }
    case 'o': {
      const num = toInteger(arg);
      const abs = num < 0 ? num >>> 0 : num;
      result = abs.toString(8);
      return padString(result, width, leftAlign, zeroPad && !leftAlign ? '0' : ' ');
    }
    case 'c': {
      // Character - take first char of arg or char from numeric value
      if (arg.length > 0) {
        result = arg[0];
      } else {
        result = '';
      }
      return padString(result, width, leftAlign, ' ');
    }
    default:
      return `%${specifier}`;
  }
}

/**
 * Convert string to integer (bash-style: empty string = 0, leading 0 = octal, 0x = hex).
 */
function toInteger(s: string): number {
  if (s.length === 0) return 0;

  // Handle character syntax: 'c or "c
  if ((s[0] === "'" || s[0] === '"') && s.length >= 2) {
    return s.charCodeAt(1);
  }

  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;

  // Handle hex
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    const val = Number.parseInt(trimmed.slice(2), 16);
    return Number.isNaN(val) ? 0 : val;
  }

  // Handle octal (leading 0)
  if (trimmed.length > 1 && trimmed[0] === '0' && trimmed[1] >= '0' && trimmed[1] <= '7') {
    const val = Number.parseInt(trimmed, 8);
    return Number.isNaN(val) ? 0 : val;
  }

  const val = Number.parseInt(trimmed, 10);
  return Number.isNaN(val) ? 0 : val;
}

/**
 * Convert string to float.
 */
function toFloat(s: string): number {
  if (s.length === 0) return 0;
  const val = Number.parseFloat(s);
  return Number.isNaN(val) ? 0 : val;
}

/**
 * Format an integer with optional sign.
 */
function formatInteger(num: number, forceSign: boolean, spaceSign: boolean): string {
  let result = num.toString();
  if (num >= 0) {
    if (forceSign) result = `+${result}`;
    else if (spaceSign) result = ` ${result}`;
  }
  return result;
}

/**
 * Pad a string to the left with a character to reach minimum width.
 */
function padLeft(s: string, width: number, ch: string): string {
  let result = s;
  while (result.length < width) {
    result = ch + result;
  }
  return result;
}

/**
 * Pad a string to the specified width, respecting alignment.
 */
function padString(s: string, width: number, leftAlign: boolean, padChar: string): string {
  if (s.length >= width) return s;
  const padding = width - s.length;
  let pad = '';
  for (let i = 0; i < padding; i++) {
    pad += padChar;
  }
  return leftAlign ? s + pad : pad + s;
}
