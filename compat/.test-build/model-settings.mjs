var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from2, except, desc) => {
  if (from2 && typeof from2 === "object" || typeof from2 === "function") {
    for (let key of __getOwnPropNames(from2))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// desktop/compat/node_modules/fuzzysort/fuzzysort.js
var require_fuzzysort = __commonJS({
  "desktop/compat/node_modules/fuzzysort/fuzzysort.js"(exports, module) {
    ((root, UMD) => {
      if (typeof define === "function" && define.amd) define([], UMD);
      else if (typeof module === "object" && module.exports) module.exports = UMD();
      else root["fuzzysort"] = UMD();
    })(exports, (_) => {
      "use strict";
      var single = (search, target) => {
        if (!search || !target) return NULL;
        var preparedSearch = getPreparedSearch(search);
        if (!isPrepared(target)) target = getPrepared(target);
        var searchBitflags = preparedSearch.bitflags;
        if ((searchBitflags & target._bitflags) !== searchBitflags) return NULL;
        return algorithm(preparedSearch, target);
      };
      var go = (search, targets, options) => {
        if (!search) return options?.all ? all(targets, options) : noResults;
        var preparedSearch = getPreparedSearch(search);
        var searchBitflags = preparedSearch.bitflags;
        var containsSpace = preparedSearch.containsSpace;
        var threshold = denormalizeScore(options?.threshold || 0);
        var limit = options?.limit || INFINITY;
        var resultsLen = 0;
        var limitedCount = 0;
        var targetsLen = targets.length;
        function push_result(result2) {
          if (resultsLen < limit) {
            q.add(result2);
            ++resultsLen;
          } else {
            ++limitedCount;
            if (result2._score > q.peek()._score) q.replaceTop(result2);
          }
        }
        if (options?.key) {
          var key = options.key;
          for (var i = 0; i < targetsLen; ++i) {
            var obj = targets[i];
            var target = getValue(obj, key);
            if (!target) continue;
            if (!isPrepared(target)) target = getPrepared(target);
            if ((searchBitflags & target._bitflags) !== searchBitflags) continue;
            var result = algorithm(preparedSearch, target);
            if (result === NULL) continue;
            if (result._score < threshold) continue;
            result.obj = obj;
            push_result(result);
          }
        } else if (options?.keys) {
          var keys = options.keys;
          var keysLen = keys.length;
          outer: for (var i = 0; i < targetsLen; ++i) {
            var obj = targets[i];
            {
              var keysBitflags = 0;
              for (var keyI = 0; keyI < keysLen; ++keyI) {
                var key = keys[keyI];
                var target = getValue(obj, key);
                if (!target) {
                  tmpTargets[keyI] = noTarget;
                  continue;
                }
                if (!isPrepared(target)) target = getPrepared(target);
                tmpTargets[keyI] = target;
                keysBitflags |= target._bitflags;
              }
              if ((searchBitflags & keysBitflags) !== searchBitflags) continue;
            }
            if (containsSpace) for (let i2 = 0; i2 < preparedSearch.spaceSearches.length; i2++) keysSpacesBestScores[i2] = NEGATIVE_INFINITY;
            for (var keyI = 0; keyI < keysLen; ++keyI) {
              target = tmpTargets[keyI];
              if (target === noTarget) {
                tmpResults[keyI] = noTarget;
                continue;
              }
              tmpResults[keyI] = algorithm(
                preparedSearch,
                target,
                /*allowSpaces=*/
                false,
                /*allowPartialMatch=*/
                containsSpace
              );
              if (tmpResults[keyI] === NULL) {
                tmpResults[keyI] = noTarget;
                continue;
              }
              if (containsSpace) for (let i2 = 0; i2 < preparedSearch.spaceSearches.length; i2++) {
                if (allowPartialMatchScores[i2] > -1e3) {
                  if (keysSpacesBestScores[i2] > NEGATIVE_INFINITY) {
                    var tmp = (keysSpacesBestScores[i2] + allowPartialMatchScores[i2]) / 4;
                    if (tmp > keysSpacesBestScores[i2]) keysSpacesBestScores[i2] = tmp;
                  }
                }
                if (allowPartialMatchScores[i2] > keysSpacesBestScores[i2]) keysSpacesBestScores[i2] = allowPartialMatchScores[i2];
              }
            }
            if (containsSpace) {
              for (let i2 = 0; i2 < preparedSearch.spaceSearches.length; i2++) {
                if (keysSpacesBestScores[i2] === NEGATIVE_INFINITY) continue outer;
              }
            } else {
              var hasAtLeast1Match = false;
              for (let i2 = 0; i2 < keysLen; i2++) {
                if (tmpResults[i2]._score !== NEGATIVE_INFINITY) {
                  hasAtLeast1Match = true;
                  break;
                }
              }
              if (!hasAtLeast1Match) continue;
            }
            var objResults = new KeysResult(keysLen);
            for (let i2 = 0; i2 < keysLen; i2++) {
              objResults[i2] = tmpResults[i2];
            }
            if (containsSpace) {
              var score = 0;
              for (let i2 = 0; i2 < preparedSearch.spaceSearches.length; i2++) score += keysSpacesBestScores[i2];
            } else {
              var score = NEGATIVE_INFINITY;
              for (let i2 = 0; i2 < keysLen; i2++) {
                var result = objResults[i2];
                if (result._score > -1e3) {
                  if (score > NEGATIVE_INFINITY) {
                    var tmp = (score + result._score) / 4;
                    if (tmp > score) score = tmp;
                  }
                }
                if (result._score > score) score = result._score;
              }
            }
            objResults.obj = obj;
            objResults._score = score;
            if (options?.scoreFn) {
              score = options.scoreFn(objResults);
              if (!score) continue;
              score = denormalizeScore(score);
              objResults._score = score;
            }
            if (score < threshold) continue;
            push_result(objResults);
          }
        } else {
          for (var i = 0; i < targetsLen; ++i) {
            var target = targets[i];
            if (!target) continue;
            if (!isPrepared(target)) target = getPrepared(target);
            if ((searchBitflags & target._bitflags) !== searchBitflags) continue;
            var result = algorithm(preparedSearch, target);
            if (result === NULL) continue;
            if (result._score < threshold) continue;
            push_result(result);
          }
        }
        if (resultsLen === 0) return noResults;
        var results = new Array(resultsLen);
        for (var i = resultsLen - 1; i >= 0; --i) results[i] = q.poll();
        results.total = resultsLen + limitedCount;
        return results;
      };
      var highlight = (result, open = "<b>", close = "</b>") => {
        var callback = typeof open === "function" ? open : void 0;
        var target = result.target;
        var targetLen = target.length;
        var indexes = result.indexes;
        var highlighted = "";
        var matchI = 0;
        var indexesI = 0;
        var opened = false;
        var parts = [];
        for (var i = 0; i < targetLen; ++i) {
          var char = target[i];
          if (indexes[indexesI] === i) {
            ++indexesI;
            if (!opened) {
              opened = true;
              if (callback) {
                parts.push(highlighted);
                highlighted = "";
              } else {
                highlighted += open;
              }
            }
            if (indexesI === indexes.length) {
              if (callback) {
                highlighted += char;
                parts.push(callback(highlighted, matchI++));
                highlighted = "";
                parts.push(target.substr(i + 1));
              } else {
                highlighted += char + close + target.substr(i + 1);
              }
              break;
            }
          } else {
            if (opened) {
              opened = false;
              if (callback) {
                parts.push(callback(highlighted, matchI++));
                highlighted = "";
              } else {
                highlighted += close;
              }
            }
          }
          highlighted += char;
        }
        return callback ? parts : highlighted;
      };
      var prepare = (target) => {
        if (typeof target === "number") target = "" + target;
        else if (typeof target !== "string") target = "";
        var info = prepareLowerInfo(target);
        return new_result(target, { _targetLower: info._lower, _targetLowerCodes: info.lowerCodes, _bitflags: info.bitflags });
      };
      var cleanup = () => {
        preparedCache.clear();
        preparedSearchCache.clear();
      };
      class Result {
        get ["indexes"]() {
          return this._indexes.slice(0, this._indexes.len).sort((a, b) => a - b);
        }
        set ["indexes"](indexes) {
          return this._indexes = indexes;
        }
        ["highlight"](open, close) {
          return highlight(this, open, close);
        }
        get ["score"]() {
          return normalizeScore(this._score);
        }
        set ["score"](score) {
          this._score = denormalizeScore(score);
        }
      }
      class KeysResult extends Array {
        get ["score"]() {
          return normalizeScore(this._score);
        }
        set ["score"](score) {
          this._score = denormalizeScore(score);
        }
      }
      var new_result = (target, options) => {
        const result = new Result();
        result["target"] = target;
        result["obj"] = options.obj ?? NULL;
        result._score = options._score ?? NEGATIVE_INFINITY;
        result._indexes = options._indexes ?? [];
        result._targetLower = options._targetLower ?? "";
        result._targetLowerCodes = options._targetLowerCodes ?? NULL;
        result._nextBeginningIndexes = options._nextBeginningIndexes ?? NULL;
        result._bitflags = options._bitflags ?? 0;
        return result;
      };
      var normalizeScore = (score) => {
        if (score === NEGATIVE_INFINITY) return 0;
        if (score > 1) return score;
        return Math.E ** (((-score + 1) ** 0.04307 - 1) * -2);
      };
      var denormalizeScore = (normalizedScore) => {
        if (normalizedScore === 0) return NEGATIVE_INFINITY;
        if (normalizedScore > 1) return normalizedScore;
        return 1 - Math.pow(Math.log(normalizedScore) / -2 + 1, 1 / 0.04307);
      };
      var prepareSearch = (search) => {
        if (typeof search === "number") search = "" + search;
        else if (typeof search !== "string") search = "";
        search = search.trim();
        var info = prepareLowerInfo(search);
        var spaceSearches = [];
        if (info.containsSpace) {
          var searches = search.split(/\s+/);
          searches = [...new Set(searches)];
          for (var i = 0; i < searches.length; i++) {
            if (searches[i] === "") continue;
            var _info = prepareLowerInfo(searches[i]);
            spaceSearches.push({ lowerCodes: _info.lowerCodes, _lower: searches[i].toLowerCase(), containsSpace: false });
          }
        }
        return { lowerCodes: info.lowerCodes, _lower: info._lower, containsSpace: info.containsSpace, bitflags: info.bitflags, spaceSearches };
      };
      var getPrepared = (target) => {
        if (target.length > 999) return prepare(target);
        var targetPrepared = preparedCache.get(target);
        if (targetPrepared !== void 0) return targetPrepared;
        targetPrepared = prepare(target);
        preparedCache.set(target, targetPrepared);
        return targetPrepared;
      };
      var getPreparedSearch = (search) => {
        if (search.length > 999) return prepareSearch(search);
        var searchPrepared = preparedSearchCache.get(search);
        if (searchPrepared !== void 0) return searchPrepared;
        searchPrepared = prepareSearch(search);
        preparedSearchCache.set(search, searchPrepared);
        return searchPrepared;
      };
      var all = (targets, options) => {
        var results = [];
        results.total = targets.length;
        var limit = options?.limit || INFINITY;
        if (options?.key) {
          for (var i = 0; i < targets.length; i++) {
            var obj = targets[i];
            var target = getValue(obj, options.key);
            if (target == NULL) continue;
            if (!isPrepared(target)) target = getPrepared(target);
            var result = new_result(target.target, { _score: target._score, obj });
            results.push(result);
            if (results.length >= limit) return results;
          }
        } else if (options?.keys) {
          for (var i = 0; i < targets.length; i++) {
            var obj = targets[i];
            var objResults = new KeysResult(options.keys.length);
            for (var keyI = options.keys.length - 1; keyI >= 0; --keyI) {
              var target = getValue(obj, options.keys[keyI]);
              if (!target) {
                objResults[keyI] = noTarget;
                continue;
              }
              if (!isPrepared(target)) target = getPrepared(target);
              target._score = NEGATIVE_INFINITY;
              target._indexes.len = 0;
              objResults[keyI] = target;
            }
            objResults.obj = obj;
            objResults._score = NEGATIVE_INFINITY;
            results.push(objResults);
            if (results.length >= limit) return results;
          }
        } else {
          for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            if (target == NULL) continue;
            if (!isPrepared(target)) target = getPrepared(target);
            target._score = NEGATIVE_INFINITY;
            target._indexes.len = 0;
            results.push(target);
            if (results.length >= limit) return results;
          }
        }
        return results;
      };
      var algorithm = (preparedSearch, prepared, allowSpaces = false, allowPartialMatch = false) => {
        if (allowSpaces === false && preparedSearch.containsSpace) return algorithmSpaces(preparedSearch, prepared, allowPartialMatch);
        var searchLower = preparedSearch._lower;
        var searchLowerCodes = preparedSearch.lowerCodes;
        var searchLowerCode = searchLowerCodes[0];
        var targetLowerCodes = prepared._targetLowerCodes;
        var searchLen = searchLowerCodes.length;
        var targetLen = targetLowerCodes.length;
        var searchI = 0;
        var targetI = 0;
        var matchesSimpleLen = 0;
        for (; ; ) {
          var isMatch = searchLowerCode === targetLowerCodes[targetI];
          if (isMatch) {
            matchesSimple[matchesSimpleLen++] = targetI;
            ++searchI;
            if (searchI === searchLen) break;
            searchLowerCode = searchLowerCodes[searchI];
          }
          ++targetI;
          if (targetI >= targetLen) return NULL;
        }
        var searchI = 0;
        var successStrict = false;
        var matchesStrictLen = 0;
        var nextBeginningIndexes = prepared._nextBeginningIndexes;
        if (nextBeginningIndexes === NULL) nextBeginningIndexes = prepared._nextBeginningIndexes = prepareNextBeginningIndexes(prepared.target);
        targetI = matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1];
        var backtrackCount = 0;
        if (targetI !== targetLen) for (; ; ) {
          if (targetI >= targetLen) {
            if (searchI <= 0) break;
            ++backtrackCount;
            if (backtrackCount > 200) break;
            --searchI;
            var lastMatch = matchesStrict[--matchesStrictLen];
            targetI = nextBeginningIndexes[lastMatch];
          } else {
            var isMatch = searchLowerCodes[searchI] === targetLowerCodes[targetI];
            if (isMatch) {
              matchesStrict[matchesStrictLen++] = targetI;
              ++searchI;
              if (searchI === searchLen) {
                successStrict = true;
                break;
              }
              ++targetI;
            } else {
              targetI = nextBeginningIndexes[targetI];
            }
          }
        }
        var substringIndex = searchLen <= 1 ? -1 : prepared._targetLower.indexOf(searchLower, matchesSimple[0]);
        var isSubstring = !!~substringIndex;
        var isSubstringBeginning = !isSubstring ? false : substringIndex === 0 || prepared._nextBeginningIndexes[substringIndex - 1] === substringIndex;
        if (isSubstring && !isSubstringBeginning) {
          for (var i = 0; i < nextBeginningIndexes.length; i = nextBeginningIndexes[i]) {
            if (i <= substringIndex) continue;
            for (var s = 0; s < searchLen; s++) if (searchLowerCodes[s] !== prepared._targetLowerCodes[i + s]) break;
            if (s === searchLen) {
              substringIndex = i;
              isSubstringBeginning = true;
              break;
            }
          }
        }
        var calculateScore = (matches) => {
          var score2 = 0;
          var extraMatchGroupCount = 0;
          for (var i2 = 1; i2 < searchLen; ++i2) {
            if (matches[i2] - matches[i2 - 1] !== 1) {
              score2 -= matches[i2];
              ++extraMatchGroupCount;
            }
          }
          var unmatchedDistance = matches[searchLen - 1] - matches[0] - (searchLen - 1);
          score2 -= (12 + unmatchedDistance) * extraMatchGroupCount;
          if (matches[0] !== 0) score2 -= matches[0] * matches[0] * 0.2;
          if (!successStrict) {
            score2 *= 1e3;
          } else {
            var uniqueBeginningIndexes = 1;
            for (var i2 = nextBeginningIndexes[0]; i2 < targetLen; i2 = nextBeginningIndexes[i2]) ++uniqueBeginningIndexes;
            if (uniqueBeginningIndexes > 24) score2 *= (uniqueBeginningIndexes - 24) * 10;
          }
          score2 -= (targetLen - searchLen) / 2;
          if (isSubstring) score2 /= 1 + searchLen * searchLen * 1;
          if (isSubstringBeginning) score2 /= 1 + searchLen * searchLen * 1;
          score2 -= (targetLen - searchLen) / 2;
          return score2;
        };
        if (!successStrict) {
          if (isSubstring) for (var i = 0; i < searchLen; ++i) matchesSimple[i] = substringIndex + i;
          var matchesBest = matchesSimple;
          var score = calculateScore(matchesBest);
        } else {
          if (isSubstringBeginning) {
            for (var i = 0; i < searchLen; ++i) matchesSimple[i] = substringIndex + i;
            var matchesBest = matchesSimple;
            var score = calculateScore(matchesSimple);
          } else {
            var matchesBest = matchesStrict;
            var score = calculateScore(matchesStrict);
          }
        }
        prepared._score = score;
        for (var i = 0; i < searchLen; ++i) prepared._indexes[i] = matchesBest[i];
        prepared._indexes.len = searchLen;
        const result = new Result();
        result.target = prepared.target;
        result._score = prepared._score;
        result._indexes = prepared._indexes;
        return result;
      };
      var algorithmSpaces = (preparedSearch, target, allowPartialMatch) => {
        var seen_indexes = /* @__PURE__ */ new Set();
        var score = 0;
        var result = NULL;
        var first_seen_index_last_search = 0;
        var searches = preparedSearch.spaceSearches;
        var searchesLen = searches.length;
        var changeslen = 0;
        var resetNextBeginningIndexes = () => {
          for (let i2 = changeslen - 1; i2 >= 0; i2--) target._nextBeginningIndexes[nextBeginningIndexesChanges[i2 * 2 + 0]] = nextBeginningIndexesChanges[i2 * 2 + 1];
        };
        var hasAtLeast1Match = false;
        for (var i = 0; i < searchesLen; ++i) {
          allowPartialMatchScores[i] = NEGATIVE_INFINITY;
          var search = searches[i];
          result = algorithm(search, target);
          if (allowPartialMatch) {
            if (result === NULL) continue;
            hasAtLeast1Match = true;
          } else {
            if (result === NULL) {
              resetNextBeginningIndexes();
              return NULL;
            }
          }
          var isTheLastSearch = i === searchesLen - 1;
          if (!isTheLastSearch) {
            var indexes = result._indexes;
            var indexesIsConsecutiveSubstring = true;
            for (let i2 = 0; i2 < indexes.len - 1; i2++) {
              if (indexes[i2 + 1] - indexes[i2] !== 1) {
                indexesIsConsecutiveSubstring = false;
                break;
              }
            }
            if (indexesIsConsecutiveSubstring) {
              var newBeginningIndex = indexes[indexes.len - 1] + 1;
              var toReplace = target._nextBeginningIndexes[newBeginningIndex - 1];
              for (let i2 = newBeginningIndex - 1; i2 >= 0; i2--) {
                if (toReplace !== target._nextBeginningIndexes[i2]) break;
                target._nextBeginningIndexes[i2] = newBeginningIndex;
                nextBeginningIndexesChanges[changeslen * 2 + 0] = i2;
                nextBeginningIndexesChanges[changeslen * 2 + 1] = toReplace;
                changeslen++;
              }
            }
          }
          score += result._score / searchesLen;
          allowPartialMatchScores[i] = result._score / searchesLen;
          if (result._indexes[0] < first_seen_index_last_search) {
            score -= (first_seen_index_last_search - result._indexes[0]) * 2;
          }
          first_seen_index_last_search = result._indexes[0];
          for (var j = 0; j < result._indexes.len; ++j) seen_indexes.add(result._indexes[j]);
        }
        if (allowPartialMatch && !hasAtLeast1Match) return NULL;
        resetNextBeginningIndexes();
        var allowSpacesResult = algorithm(
          preparedSearch,
          target,
          /*allowSpaces=*/
          true
        );
        if (allowSpacesResult !== NULL && allowSpacesResult._score > score) {
          if (allowPartialMatch) {
            for (var i = 0; i < searchesLen; ++i) {
              allowPartialMatchScores[i] = allowSpacesResult._score / searchesLen;
            }
          }
          return allowSpacesResult;
        }
        if (allowPartialMatch) result = target;
        result._score = score;
        var i = 0;
        for (let index of seen_indexes) result._indexes[i++] = index;
        result._indexes.len = i;
        return result;
      };
      var remove_accents = (str) => str.replace(new RegExp("\\p{Script=Latin}+", "gu"), (match) => match.normalize("NFD")).replace(/[\u0300-\u036f]/g, "");
      var prepareLowerInfo = (str) => {
        str = remove_accents(str);
        var strLen = str.length;
        var lower = str.toLowerCase();
        var lowerCodes = [];
        var bitflags = 0;
        var containsSpace = false;
        for (var i = 0; i < strLen; ++i) {
          var lowerCode = lowerCodes[i] = lower.charCodeAt(i);
          if (lowerCode === 32) {
            containsSpace = true;
            continue;
          }
          var bit = lowerCode >= 97 && lowerCode <= 122 ? lowerCode - 97 : lowerCode >= 48 && lowerCode <= 57 ? 26 : lowerCode <= 127 ? 30 : 31;
          bitflags |= 1 << bit;
        }
        return { lowerCodes, bitflags, containsSpace, _lower: lower };
      };
      var prepareBeginningIndexes = (target) => {
        var targetLen = target.length;
        var beginningIndexes = [];
        var beginningIndexesLen = 0;
        var wasUpper = false;
        var wasAlphanum = false;
        for (var i = 0; i < targetLen; ++i) {
          var targetCode = target.charCodeAt(i);
          var isUpper = targetCode >= 65 && targetCode <= 90;
          var isAlphanum = isUpper || targetCode >= 97 && targetCode <= 122 || targetCode >= 48 && targetCode <= 57;
          var isBeginning = isUpper && !wasUpper || !wasAlphanum || !isAlphanum;
          wasUpper = isUpper;
          wasAlphanum = isAlphanum;
          if (isBeginning) beginningIndexes[beginningIndexesLen++] = i;
        }
        return beginningIndexes;
      };
      var prepareNextBeginningIndexes = (target) => {
        target = remove_accents(target);
        var targetLen = target.length;
        var beginningIndexes = prepareBeginningIndexes(target);
        var nextBeginningIndexes = [];
        var lastIsBeginning = beginningIndexes[0];
        var lastIsBeginningI = 0;
        for (var i = 0; i < targetLen; ++i) {
          if (lastIsBeginning > i) {
            nextBeginningIndexes[i] = lastIsBeginning;
          } else {
            lastIsBeginning = beginningIndexes[++lastIsBeginningI];
            nextBeginningIndexes[i] = lastIsBeginning === void 0 ? targetLen : lastIsBeginning;
          }
        }
        return nextBeginningIndexes;
      };
      var preparedCache = /* @__PURE__ */ new Map();
      var preparedSearchCache = /* @__PURE__ */ new Map();
      var matchesSimple = [];
      var matchesStrict = [];
      var nextBeginningIndexesChanges = [];
      var keysSpacesBestScores = [];
      var allowPartialMatchScores = [];
      var tmpTargets = [];
      var tmpResults = [];
      var getValue = (obj, prop) => {
        var tmp = obj[prop];
        if (tmp !== void 0) return tmp;
        if (typeof prop === "function") return prop(obj);
        var segs = prop;
        if (!Array.isArray(prop)) segs = prop.split(".");
        var len = segs.length;
        var i = -1;
        while (obj && ++i < len) obj = obj[segs[i]];
        return obj;
      };
      var isPrepared = (x) => {
        return typeof x === "object" && typeof x._bitflags === "number";
      };
      var INFINITY = Infinity;
      var NEGATIVE_INFINITY = -INFINITY;
      var noResults = [];
      noResults.total = 0;
      var NULL = null;
      var noTarget = prepare("");
      var fastpriorityqueue = (r2) => {
        var e = [], o = 0, a = {}, v = (r3) => {
          for (var a2 = 0, v2 = e[a2], c = 1; c < o; ) {
            var s = c + 1;
            a2 = c, s < o && e[s]._score < e[c]._score && (a2 = s), e[a2 - 1 >> 1] = e[a2], c = 1 + (a2 << 1);
          }
          for (var f = a2 - 1 >> 1; a2 > 0 && v2._score < e[f]._score; f = (a2 = f) - 1 >> 1) e[a2] = e[f];
          e[a2] = v2;
        };
        return a.add = ((r3) => {
          var a2 = o;
          e[o++] = r3;
          for (var v2 = a2 - 1 >> 1; a2 > 0 && r3._score < e[v2]._score; v2 = (a2 = v2) - 1 >> 1) e[a2] = e[v2];
          e[a2] = r3;
        }), a.poll = ((r3) => {
          if (0 !== o) {
            var a2 = e[0];
            return e[0] = e[--o], v(), a2;
          }
        }), a.peek = ((r3) => {
          if (0 !== o) return e[0];
        }), a.replaceTop = ((r3) => {
          e[0] = r3, v();
        }), a;
      };
      var q = fastpriorityqueue();
      return { "single": single, "go": go, "prepare": prepare, "cleanup": cleanup };
    });
  }
});

// desktop/compat/src/model-settings.tsx
import { useMemo as useMemo4 } from "react";

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelsSection.tsx
import { useId as useId2, useState as useState9 } from "react";

// deepseek-harness/packages/client/ui-primitives/src/Button.tsx
import { forwardRef } from "react";

// desktop/compat/node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}
var clsx_default = clsx;

// deepseek-harness/packages/client/ui-primitives/src/Button.module.css
var Button_default = {
  button: "Button_button",
  md: "Button_md",
  sm: "Button_sm",
  primary: "Button_primary",
  ghost: "Button_ghost",
  outline: "Button_outline",
  toolbar: "Button_toolbar",
  icon: "Button_icon"
};

// deepseek-harness/packages/client/ui-primitives/src/Button.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var Button = forwardRef(function Button2({
  variant = "ghost",
  size = "md",
  icon,
  className,
  children,
  ...rest
}, ref) {
  return /* @__PURE__ */ jsxs("button", { ref, type: "button", className: clsx_default(Button_default.button, Button_default[variant], Button_default[size], className), ...rest, children: [
    icon != null && /* @__PURE__ */ jsx("span", { className: Button_default.icon, children: icon }),
    children
  ] });
});

// deepseek-harness/packages/client/ui-primitives/src/icons/artwork.ts
var ICON_REGULAR_STROKE = 1;
var ICON_MEDIUM_STROKE = 1.3;
var ICON_ARTWORK = {
  "mail-unread-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3.5H3C2.44772 3.5 2 3.94772 2 4.5V11.5C2 12.0523 2.44772 12.5 3 12.5H13C13.5523 12.5 14 12.0523 14 11.5V7" stroke="currentColor"></path><path d="M2.5 4.5L8 8.5L10.5 6.7" stroke="currentColor"></path><circle cx="12.5" cy="3.5" r="1.5" fill="currentColor"></circle></svg>` },
  "mail-read-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L7.4 2.45C7.75556 2.18333 8.24444 2.18333 8.6 2.45L14 6.5V12.5C14 13.0523 13.5523 13.5 13 13.5H3C2.44772 13.5 2 13.0523 2 12.5V6.5Z" stroke="currentColor"></path><path d="M2.5 7L8 10.5L13.5 7M2.5 13L6 9.5M13.5 13L10 9.5" stroke="currentColor"></path></svg>` },
  "layers-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="M8.481371 2.304371 a1.159971 1.159971 0 0 0-.962742 0 L2.547971 4.566371 a.580029 .580029 0 0 0 0 1.0614 l4.9764 2.267829 a1.159971 1.159971 0 0 0 .962829 0 l4.9764-2.262 a.580029 .580029 0 0 0 0-1.0614Z" stroke="currentColor"></path><path d="M2.199971 8 a.580029 .580029 0 0 0 .336429 .527829 l4.987971 2.267742 a1.159971 1.159971 0 0 0 .957 0 l4.9764-2.262 A.580029 .580029 0 0 0 13.800029 8" stroke="currentColor"></path><path d="M2.199971 10.899971 a.580029 .580029 0 0 0 .336429 .527829 l4.987971 2.267829 a1.159971 1.159971 0 0 0 .957 0 l4.9764-2.262 A.580029 .580029 0 0 0 13.800029 10.899971" stroke="currentColor"></path></svg>` },
  "save-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round"><path d="M2.5 1.5h8l3 3v9a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"></path><path d="M4.5 1.5v4h6v-4M4 14.5v-6h7v6"></path></svg>` },
  "new-chat-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337" stroke="currentColor"></path><path d="M8 5V11" stroke="currentColor"></path><path d="M5 8H11" stroke="currentColor"></path></svg>` },
  "search-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z" stroke="currentColor"></path><path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor"></path></svg>` },
  "eye-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M1.5 8C3.36 4.41 5.52 2.63 8 2.63C10.48 2.63 12.64 4.41 14.5 8C12.64 11.59 10.48 13.37 8 13.37C5.52 13.37 3.36 11.59 1.5 8Z" stroke="currentColor"></path><circle cx="8" cy="8" r="2.25" stroke="currentColor"></circle></svg>` },
  "eye-off-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.25 2.25L13.75 13.75" stroke="currentColor"></path><path d="M6.35 3.03C6.88 2.76 7.42 2.63 8 2.63C10.48 2.63 12.64 4.41 14.5 8C13.75 9.48 12.95 10.6 12.08 11.36" stroke="currentColor"></path><path d="M10.28 12.81C9.54 13.19 8.78 13.37 8 13.37C5.52 13.37 3.36 11.59 1.5 8C2.26 6.49 3.08 5.36 3.97 4.6" stroke="currentColor"></path><path d="M6.55 6.55A2.05 2.05 0 0 0 9.45 9.45" stroke="currentColor"></path></svg>` },
  "globe-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z" stroke="currentColor"></path><path d="M2.34619 8H13.6538" stroke="currentColor" stroke-linecap="square"></path><path d="M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138" stroke="currentColor"></path><path d="M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138" stroke="currentColor"></path></svg>` },
  "settings-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z" stroke="currentColor"></path><path d="M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z" stroke="currentColor" stroke-miterlimit="10"></path></svg>` },
  "panel-left-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor"></path><path d="M5.5 1.5V14.5" stroke="currentColor"></path></svg>` },
  "ellipsis-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z" fill="currentColor"></path><path d="M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" fill="currentColor"></path><path d="M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z" fill="currentColor"></path></svg>` },
  "plus-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 2V14" stroke="currentColor"></path><path d="M2 8H14" stroke="currentColor"></path></svg>` },
  "check-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"></path></svg>` },
  "branch-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564" stroke="currentColor"></path><path d="M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944" stroke="currentColor"></path><circle cx="12.4502" cy="3.3079" r="1.56962" stroke="currentColor"></circle><circle cx="12.4502" cy="12.6921" r="1.56962" stroke="currentColor"></circle></svg>` },
  "chevron-down-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor"></path></svg>` },
  "chevron-left-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12" stroke="currentColor"></path></svg>` },
  "chevron-right-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4" stroke="currentColor"></path></svg>` },
  "triangle-right-fill": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z" fill="currentColor"></path></svg>` },
  "chevron-up-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10" stroke="currentColor"></path></svg>` },
  "close-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.5 2.5L13.5 13.5" stroke="currentColor"></path><path d="M13.5 2.5L2.5 13.5" stroke="currentColor"></path></svg>` },
  "close-fill": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3.5 3.5L12.5 12.5" stroke="currentColor"></path><path d="M12.5 3.5L3.5 12.5" stroke="currentColor"></path></svg>` },
  "close-circle-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path fill-rule="evenodd" clip-rule="evenodd" d="M15 8A7 7 0 1 1 1 8A7 7 0 1 1 15 8ZM6.409 10.652L5.348 9.591L6.939 8L5.348 6.409L6.409 5.348L8 6.939L9.591 5.348L10.652 6.409L9.061 8L10.652 9.591L9.591 10.652L8 9.061Z" fill="currentColor"></path></svg>` },
  "copy-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor"></rect><path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor"></path></svg>` },
  "refresh-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1" stroke="currentColor"></path><path d="M14.4999 1.5V5.1H10.8999" stroke="currentColor"></path></svg>` },
  "like-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.537 8.12098L12.3983 12.8455C12.1818 13.7438 11.378 14.3769 10.454 14.3769L9.35595 14.3769H7.43799H5.16577C3.50892 14.3769 2.16577 13.0337 2.16577 11.3769V7.88668C2.16577 7.33439 2.61349 6.88668 3.16577 6.88668H4.02665C5.84943 6.88668 7.38083 3.28711 7.67689 2.54578C7.71259 2.45639 7.73501 2.36373 7.77922 2.27824C7.86506 2.11221 8.08228 1.87578 8.59039 2.07775C10.3291 2.76886 9.23144 6.04071 8.96955 6.75058C8.94502 6.81707 8.99495 6.88668 9.06581 6.88668H12.5648C13.2119 6.88668 13.6886 7.49192 13.537 8.12098Z" stroke="currentColor"></path></svg>` },
  "like-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.537 8.12098L12.3983 12.8455C12.1818 13.7438 11.378 14.3769 10.454 14.3769L9.35595 14.3769H7.43799H5.16577C3.50892 14.3769 2.16577 13.0337 2.16577 11.3769V7.88668C2.16577 7.33439 2.61349 6.88668 3.16577 6.88668H4.02665C5.84943 6.88668 7.38083 3.28711 7.67689 2.54578C7.71259 2.45639 7.73501 2.36373 7.77922 2.27824C7.86506 2.11221 8.08228 1.87578 8.59039 2.07775C10.3291 2.76886 9.23144 6.04071 8.96955 6.75058C8.94502 6.81707 8.99495 6.88668 9.06581 6.88668H12.5648C13.2119 6.88668 13.6886 7.49192 13.537 8.12098Z" fill="currentColor" stroke="currentColor"></path></svg>` },
  "dislike-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.46302 8.06749L3.60171 3.34299C3.81822 2.44467 4.62196 1.81162 5.546 1.8116L6.64406 1.81158L8.56202 1.81158L10.8342 1.81158C12.4911 1.81158 13.8342 3.15473 13.8342 4.81158L13.8342 8.3018C13.8342 8.85408 13.3865 9.3018 12.8342 9.3018L11.9734 9.3018C10.1506 9.3018 8.61918 12.9014 8.32311 13.6427C8.28741 13.7321 8.26499 13.8247 8.22078 13.9102C8.13494 14.0763 7.91772 14.3127 7.40961 14.1107C5.67089 13.4196 6.76856 10.1478 7.03045 9.43789C7.05498 9.37141 7.00505 9.3018 6.93419 9.3018L3.43519 9.3018C2.78811 9.3018 2.31141 8.69656 2.46302 8.06749Z" stroke="currentColor"></path></svg>` },
  "dislike-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.46302 8.06749L3.60171 3.34299C3.81822 2.44467 4.62196 1.81162 5.546 1.8116L6.64406 1.81158L8.56202 1.81158L10.8342 1.81158C12.4911 1.81158 13.8342 3.15473 13.8342 4.81158L13.8342 8.3018C13.8342 8.85408 13.3865 9.3018 12.8342 9.3018L11.9734 9.3018C10.1506 9.3018 8.61918 12.9014 8.32311 13.6427C8.28741 13.7321 8.26499 13.8247 8.22078 13.9102C8.13494 14.0763 7.91772 14.3127 7.40961 14.1107C5.67089 13.4196 6.76856 10.1478 7.03045 9.43789C7.05498 9.37141 7.00505 9.3018 6.93419 9.3018L3.43519 9.3018C2.78811 9.3018 2.31141 8.69656 2.46302 8.06749Z" fill="currentColor" stroke="currentColor"></path></svg>` },
  "share-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M14.1256 7.58723C14.3483 7.81942 14.3482 8.18589 14.1254 8.41799L8.6646 14.1077C8.53985 14.2377 8.32031 14.1494 8.32031 13.9692L8.32035 10.2039C8.32035 10.1943 8.31534 10.1864 8.30592 10.1849C8.08306 10.148 5.30067 9.7729 1.50993 13.2904C1.49711 13.3023 1.47561 13.2943 1.4757 13.2768C1.49273 9.87168 3.42001 5.07166 8.29999 5.05835C8.31103 5.05832 8.32035 5.04937 8.32035 5.03832L8.32031 2.03109C8.32031 1.85088 8.53993 1.76259 8.66466 1.89266L14.1256 7.58723Z" stroke="currentColor"></path></svg>` },
  "deliver-doc": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.15479 4.91687H9.84543" stroke="currentColor"></path><path d="M11.8798 9.55347V2.71525C11.8798 2.37416 11.564 2.09766 11.1744 2.09766H4.82577C4.43618 2.09766 4.12036 2.37416 4.12036 2.71525V9.55347" stroke="currentColor"></path><path d="M2.28735 13.8022V8.84792C2.28735 8.77514 2.36262 8.72673 2.42884 8.75693L13.2936 13.7112C13.3914 13.7558 13.3596 13.9022 13.2521 13.9022H2.38735C2.33213 13.9022 2.28735 13.8575 2.28735 13.8022Z" stroke="currentColor"></path><path d="M7.46929 10.979L13.5783 8.7416C13.6435 8.7177 13.7126 8.76601 13.7126 8.83551L13.7125 13.8022C13.7125 13.8574 13.6678 13.9022 13.6125 13.9022H7.99999" stroke="currentColor"></path><path d="M6.15479 7.2395H9.05644" stroke="currentColor"></path></svg>` },
  "edit-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z" fill="currentColor"></path><path d="M7.7849 8.23878L13.888 2.13574" stroke="currentColor"></path></svg>` },
  "think-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z" stroke="currentColor"></path><path d="M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z" stroke="currentColor"></path><path d="M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z" fill="currentColor"></path></svg>` },
  "agent-preset-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.51867 12.3282C7.29816 12.6011 8.16475 12.6514 9.02269 12.4216C9.57879 12.2726 10.0784 12.0185 10.5087 11.6888C10.7819 12.0555 11.1606 12.3304 11.5913 12.4805C10.9688 13.029 10.2149 13.4478 9.35911 13.6771C8.13946 14.0038 6.90632 13.8971 5.82126 13.4533C6.15821 13.1562 6.4021 12.7652 6.51867 12.3282ZM9.17629 2.89409C11.1101 3.34433 12.739 4.81872 13.2889 6.87043C13.4219 7.3665 13.4811 7.8649 13.4774 8.35466C13.0924 8.13213 12.6422 8.01837 12.1741 8.05276L12.1711 8.05257C12.1539 7.77199 12.109 7.48889 12.0334 7.20684C11.6363 5.72533 10.5048 4.6372 9.13549 4.22844C9.25559 3.87667 9.29214 3.49087 9.22309 3.09892C9.2108 3.02922 9.19451 2.96108 9.17629 2.89409ZM4.7311 3.89107L4.78302 4.11879C4.87648 4.4488 5.04146 4.74263 5.25579 4.98896C3.98078 6.01355 3.35848 7.72904 3.8089 9.41059C3.81828 9.44559 3.82866 9.48025 3.83885 9.51479C3.38217 9.61268 2.98548 9.84137 2.68107 10.1556C2.63414 10.022 2.5897 9.88632 2.55244 9.74726C1.93301 7.43489 2.86717 5.07173 4.71504 3.76697L4.7311 3.89107Z" fill="currentColor"></path><path d="M7.99136 5.28105C8.87501 5.28105 9.59136 4.56471 9.59136 3.68105C9.59136 2.7974 8.87501 2.08105 7.99136 2.08105C7.1077 2.08105 6.39136 2.7974 6.39136 3.68105C6.39136 4.56471 7.1077 5.28105 7.99136 5.28105Z" stroke="currentColor"></path><path d="M3.94009 12.9417C4.82374 12.9417 5.54009 12.2254 5.54009 11.3417C5.54009 10.458 4.82374 9.7417 3.94009 9.7417C3.05643 9.7417 2.34009 10.458 2.34009 11.3417C2.34009 12.2254 3.05643 12.9417 3.94009 12.9417Z" stroke="currentColor"></path><path d="M12.0851 12.9417C12.9688 12.9417 13.6851 12.2254 13.6851 11.3417C13.6851 10.458 12.9688 9.7417 12.0851 9.7417C11.2015 9.7417 10.4851 10.458 10.4851 11.3417C10.4851 12.2254 11.2015 12.9417 12.0851 12.9417Z" stroke="currentColor"></path></svg>` },
  "browse-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4.9375 5.90295H11.0625" stroke="currentColor"></path><path d="M4.9375 9.02991H8.27841" stroke="currentColor"></path><path d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z" fill="currentColor"></path></svg>` },
  "context-injection-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M5 2.5H3.5C3.23478 2.5 2.98043 2.60536 2.79289 2.79289C2.60536 2.98043 2.5 3.23478 2.5 3.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V3.5C13.5 3.23478 13.3946 2.98043 13.2071 2.79289C13.0196 2.60536 12.7652 2.5 12.5 2.5H11" stroke="currentColor"></path><path d="M8 0.5V7.5" stroke="currentColor"></path><path d="M5.5 5L8 7.5L10.5 5" stroke="currentColor"></path><path d="M5.5 11H10.5" stroke="currentColor"></path></svg>` },
  "link-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.59961 9.40051C6.82779 9.6334 7.10015 9.81842 7.40074 9.94472C7.70132 10.071 8.02409 10.1361 8.35013 10.1361C8.67618 10.1361 8.99894 10.071 9.29953 9.94472C9.60011 9.81842 9.87247 9.6334 10.1007 9.40051L12.9015 6.59967C13.3658 6.13541 13.6266 5.50572 13.6266 4.84915C13.6266 4.19258 13.3658 3.56289 12.9015 3.09863C12.4372 2.63436 11.8075 2.37354 11.151 2.37354C10.4944 2.37354 9.86472 2.63436 9.40045 3.09863L9.05034 3.44873" stroke="currentColor"></path><path d="M9.40051 6.59959C9.17233 6.3667 8.89997 6.18169 8.59939 6.05538C8.2988 5.92907 7.97603 5.86401 7.64999 5.86401C7.32395 5.86401 7.00118 5.92907 6.70059 6.05538C6.40001 6.18169 6.12765 6.3667 5.89946 6.59959L3.09863 9.40043C2.63436 9.8647 2.37354 10.4944 2.37354 11.151C2.37354 11.8075 2.63436 12.4372 3.09863 12.9015C3.56289 13.3657 4.19258 13.6266 4.84915 13.6266C5.50572 13.6266 6.13541 13.3657 6.59967 12.9015L6.94978 12.5514" stroke="currentColor"></path></svg>` },
  "right-up-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M11.7256 2.77441C12.5538 2.77469 13.2256 3.44616 13.2256 4.27441V10.1416H12.2256V4.27441C12.2256 3.99844 12.0015 3.77469 11.7256 3.77441H5.7207V2.77441H11.7256Z" fill="currentColor"></path><path d="M2.77441 13.2255L12.3756 3.62427" stroke="currentColor"></path></svg>` },
  "enhance-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M1.98486 2.95374H14.0151" stroke="currentColor"></path><path d="M1.98486 6.31787H14.0151" stroke="currentColor"></path><path d="M1.98486 9.68213H14.0151" stroke="currentColor"></path><path d="M1.98486 13.0463H8.4627" stroke="currentColor"></path></svg>` },
  "trash-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M1.28149 3.88831H14.7187" stroke="currentColor"></path><path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" stroke="currentColor"></path><path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" stroke="currentColor"></path><path d="M6.44946 6.98926V11.1238" stroke="currentColor"></path><path d="M9.55054 6.98926V11.1238" stroke="currentColor"></path></svg>` },
  "warning-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"></path><path d="M8 4.29199V9.79199" stroke="currentColor"></path><path d="M8 10.708V11.708" stroke="currentColor"></path></svg>` },
  "check-circle-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" stroke-width="${strokeWidth}"><path d="M28.1936 14.6936L19.8066 23.0806C19.2373 23.65 18.7159 24.1742 18.24 24.5571C17.7389 24.9602 17.1365 25.3359 16.3657 25.458C15.9581 25.5225 15.5428 25.5225 15.1353 25.458C14.3645 25.3359 13.7621 24.9602 13.261 24.5571C12.7851 24.1742 12.2637 23.65 11.6943 23.0806L7.80737 19.1936L10.1936 16.8074L14.0806 20.6943C14.7033 21.317 15.0763 21.6873 15.377 21.9292C15.6523 22.1507 15.7109 22.1325 15.6626 22.1248C15.7208 22.1339 15.7802 22.1339 15.8384 22.1248C15.7901 22.1325 15.8486 22.1507 16.124 21.9292C16.4247 21.6873 16.7977 21.317 17.4204 20.6943L25.8074 12.3074L28.1936 14.6936Z" fill="currentColor"></path><path d="M32.8496 18.0005C32.8496 9.79906 26.2019 3.15137 18.0005 3.15137C9.79906 3.15137 3.15137 9.79906 3.15137 18.0005C3.15137 26.2019 9.79906 32.8496 18.0005 32.8496C26.2019 32.8496 32.8496 26.2019 32.8496 18.0005ZM35.7764 18.0005C35.7764 27.8173 27.8173 35.7764 18.0005 35.7764C8.18363 35.7764 0.224609 27.8173 0.224609 18.0005C0.224609 8.18363 8.18363 0.224609 18.0005 0.224609C27.8173 0.224609 35.7764 8.18363 35.7764 18.0005Z" fill="currentColor"></path></svg>` },
  "warning-triangle-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><path d="M6.87 2.6a1.33 1.33 0 0 1 2.26 0l5.34 9.33A1.33 1.33 0 0 1 13.33 14H2.67a1.33 1.33 0 0 1-1.14-2.07Z" stroke="currentColor"></path><path d="M8 6v3m0 2.33h.01" stroke="currentColor"></path></svg>` },
  "user-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 8.25C9.51878 8.25 10.75 7.01878 10.75 5.5C10.75 3.98122 9.51878 2.75 8 2.75C6.48122 2.75 5.25 3.98122 5.25 5.5C5.25 7.01878 6.48122 8.25 8 8.25Z" stroke="currentColor"></path><path d="M2.5 14.5C2.5 11.5 5.25 10.25 8 10.25C10.75 10.25 13.5 11.5 13.5 14.5" stroke="currentColor"></path></svg>` },
  // Users has inset contours in the 16px box; only coordinates, never stroke widths, carry the inset.
  "users-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.18 8.2275C7.5620898 8.2275 8.6825 7.1070898 8.6825 5.725C8.6825 4.3429102 7.5620898 3.2225 6.18 3.2225C4.7979102 3.2225 3.6775 4.3429102 3.6775 5.725C3.6775 7.1070898 4.7979102 8.2275 6.18 8.2275Z" stroke="currentColor"></path><path d="M1.63 13.915C1.63 11.185 3.905 10.0475 6.18 10.0475C8.455 10.0475 10.73 11.185 10.73 13.915" stroke="currentColor"></path><path d="M10.275 3.359C11.3215 3.7685 12.0495 4.6785 12.0495 5.725C12.0495 6.7715 11.3215 7.6815 10.275 8.091" stroke="currentColor"></path><path d="M12.004 10.366C13.369 11.003 14.37 12.186 14.37 13.915" stroke="currentColor"></path></svg>` },
  "paper-plane-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4.74024 9.11029L1.82882 7.79865C1.75022 7.76323 1.75026 7.65161 1.82889 7.61626L12.9665 2.60943C13.0354 2.57846 13.1125 2.63213 13.1073 2.70749L12.3914 13.1388C12.3864 13.2117 12.3073 13.2548 12.2433 13.2194L6.12677 9.83657" stroke="currentColor"></path><path d="M8.44336 11.0825L6.2832 13.2843C6.22048 13.3482 6.11182 13.3038 6.11182 13.2143V9.86772C6.11182 9.84165 6.122 9.8166 6.1402 9.79793L12.972 2.78748" stroke="currentColor"></path></svg>` },
  "stop-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12.5 2.5H3.5C2.94772 2.5 2.5 2.94772 2.5 3.5V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V3.5C13.5 2.94772 13.0523 2.5 12.5 2.5Z" fill="currentColor"></path></svg>` },
  "paperclip-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12.75 4.5V9.5C12.75 10.7598 12.2496 11.968 11.3588 12.8588C10.468 13.7496 9.25978 14.25 8 14.25C6.74022 14.25 5.53204 13.7496 4.64124 12.8588C3.75045 11.968 3.25 10.7598 3.25 9.5V5C3.25 4.13805 3.59241 3.3114 4.2019 2.7019C4.8114 2.09241 5.63805 1.75 6.5 1.75C7.36195 1.75 8.1886 2.09241 8.7981 2.7019C9.40759 3.3114 9.75 4.13805 9.75 5V9.5C9.75 9.96413 9.56563 10.4092 9.23744 10.7374C8.90925 11.0656 8.46413 11.25 8 11.25C7.53587 11.25 7.09075 11.0656 6.76256 10.7374C6.43437 10.4092 6.25 9.96413 6.25 9.5V5.5" stroke="currentColor"></path></svg>` },
  "loading-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12.596 12.596C11.687 13.5049 10.5288 14.1239 9.26798 14.3747C8.00716 14.6255 6.70028 14.4968 5.51261 14.0048C4.32494 13.5129 3.30981 12.6798 2.59557 11.611C1.88134 10.5421 1.50008 9.2855 1.5 7.99998C1.50008 6.71446 1.88134 5.45783 2.59557 4.38898C3.30981 3.32013 4.32494 2.48707 5.51261 1.99513C6.70028 1.50319 8.00716 1.37447 9.26798 1.62524C10.5288 1.87602 11.687 2.49502 12.596 3.40398" stroke="currentColor"></path></svg>` },
  "download-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 1.95317V10.0469" stroke="currentColor"></path><path d="M4.25 6.29688L8 10.0469L11.75 6.29688" stroke="currentColor"></path><path d="M1.5 10.0469V13.158C1.5 13.3937 1.60536 13.6198 1.79289 13.7865C1.98043 13.9532 2.23478 14.0469 2.5 14.0469H13.5C13.7652 14.0469 14.0196 13.9532 14.2071 13.7865C14.3946 13.6198 14.5 13.3937 14.5 13.158V10.0469" stroke="currentColor"></path></svg>` },
  "upload-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 10.0469V1.95317" stroke="currentColor"></path><path d="M4.25 5.70317L8 1.95317L11.75 5.70317" stroke="currentColor"></path><path d="M1.5 10.0469V13.158C1.5 13.3937 1.60536 13.6198 1.79289 13.7865C1.98043 13.9532 2.23478 14.0469 2.5 14.0469H13.5C13.7652 14.0469 14.0196 13.9532 14.2071 13.7865C14.3946 13.6198 14.5 13.3937 14.5 13.158V10.0469" stroke="currentColor"></path></svg>` },
  "play-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"></path><path d="M10.3329 7.91346C10.3996 7.95195 10.3996 8.04818 10.3329 8.08667L6.78304 10.1362C6.71638 10.1747 6.63304 10.1266 6.63304 10.0496L6.63304 5.95055C6.63304 5.87357 6.71638 5.82546 6.78304 5.86395L10.3329 7.91346Z" stroke="currentColor"></path></svg>` },
  "pause-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"></path><path d="M6.5 5V11" stroke="currentColor"></path><path d="M9.5 5V11" stroke="currentColor"></path></svg>` },
  "fullscreen-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.33154 9.40576V13.1685C2.3318 13.4444 2.55556 13.6685 2.83154 13.6685H6.49463V14.6685H2.83154C2.00328 14.6685 1.3318 13.9967 1.33154 13.1685V9.40576H2.33154ZM13.1685 1.33154C13.9964 1.33199 14.6683 2.00352 14.6685 2.83154V6.40576H13.6685V2.83154C13.6683 2.5558 13.4441 2.33199 13.1685 2.33154H9.49463V1.33154H13.1685Z" fill="currentColor"></path><path d="M9.4292 6.57077L13.914 2.08594" stroke="currentColor"></path><path d="M6.57077 9.4292L2.08594 13.914" stroke="currentColor"></path></svg>` },
  "code-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.27612 1.5L4.52612 14.5" stroke="currentColor"></path><path d="M11.4739 1.5L9.72388 14.5" stroke="currentColor"></path><path d="M2.39868 5.5H14.0681" stroke="currentColor"></path><path d="M1.93188 10.5H13.6013" stroke="currentColor"></path></svg>` },
  "cordis-plugin-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3.16143 6.59068L1.75205 8.00006L3.10619 9.35419L2.39908 10.0613L0.832948 8.49517C0.559581 8.2218 0.559582 7.77831 0.832948 7.50494L2.45432 5.88357L3.16143 6.59068ZM8.49511 15.1671C8.22176 15.4405 7.77826 15.4404 7.50489 15.1671L5.93461 13.5968L6.64172 12.8897L8 14.248L9.40938 12.8386L10.1165 13.5457L8.49511 15.1671ZM15.1671 7.50494C15.4403 7.7782 15.4401 8.22179 15.1671 8.49517L13.652 10.0102L12.9449 9.30309L14.248 8.00006L12.8897 6.64178L13.5968 5.93467L15.1671 7.50494ZM9.35414 3.10624L8 1.7521L6.69696 3.05514L5.98986 2.34803L7.50489 0.833003C7.77828 0.559981 8.22186 0.559752 8.49511 0.833003L10.0612 2.39913L9.35414 3.10624Z" fill="currentColor"></path><circle cx="8" cy="8" r="1.76221" stroke="currentColor"></circle></svg>` },
  "api-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3 4L7 8L3 12" stroke="currentColor"></path><path d="M9 12H13" stroke="currentColor"></path></svg>` },
  "personalization-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3.25 7.16357C3.20417 7.32247 3.17778 7.48993 3.17773 7.66357C3.17773 7.83698 3.20336 8.00486 3.24902 8.16357H1.85742V7.16357H3.25ZM14.1426 8.16357H6.71484C6.76052 8.00485 6.78613 7.837 6.78613 7.66357C6.78609 7.48991 6.75971 7.32249 6.71387 7.16357H14.1426V8.16357Z" fill="currentColor"></path><path d="M9.1377 11.9092C9.08596 12.0666 9.05668 12.2344 9.05664 12.4092C9.05664 12.5838 9.08606 12.7518 9.1377 12.9092H1.85742V11.9092H9.1377ZM14.1426 12.9092H12.1816C12.2332 12.7519 12.2617 12.5838 12.2617 12.4092C12.2617 12.2345 12.2333 12.0666 12.1816 11.9092H14.1426V12.9092Z" fill="currentColor"></path><path d="M9.1123 3.09106C9.06138 3.24865 9.03324 3.41653 9.0332 3.59106C9.0332 3.76549 9.06148 3.93355 9.1123 4.09106H1.85742V3.09106H9.1123ZM14.1426 4.09106H12.207C12.2578 3.93358 12.2861 3.76545 12.2861 3.59106C12.2861 3.41657 12.2579 3.24862 12.207 3.09106H14.1426V4.09106Z" fill="currentColor"></path><circle cx="4.97065" cy="7.66401" r="1.35151" stroke="currentColor"></circle><circle cx="10.6596" cy="12.4091" r="1.35151" stroke="currentColor"></circle><circle cx="10.6596" cy="3.59101" r="1.35151" stroke="currentColor"></circle></svg>` },
  "project-add-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z" fill="currentColor"></path><path d="M9.75977 4.50208H14.5509" stroke="currentColor"></path><path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor"></path></svg>` },
  "folder-open-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991" stroke="currentColor"></path><path d="M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z" stroke="currentColor"></path></svg>` },
  "folder-open": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z" fill="currentColor" opacity="0.16"></path><path d="M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z" fill="currentColor"></path><path d="M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z" fill="currentColor"></path></svg>` },
  "folder-close": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z" stroke="currentColor"></path><path d="M3.63501 7.66614H12.3647" stroke="currentColor"></path></svg>` },
  "tree-corner": { size: 10, aspect: [8, 10], svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 11" fill="none" stroke-width="${strokeWidth}"><path d="M0.5 0V7C0.5 7.79565 0.81607 8.55871 1.37868 9.12132C1.94129 9.68393 2.70435 10 3.5 10H8.5" stroke="currentColor"></path></svg>` },
  "light-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8.00007 11.8117C10.1052 11.8117 11.8117 10.1052 11.8117 8.00007C11.8117 5.89499 10.1052 4.18848 8.00007 4.18848C5.89499 4.18848 4.18848 5.89499 4.18848 8.00007C4.18848 10.1052 5.89499 11.8117 8.00007 11.8117Z" stroke="currentColor"></path><path d="M13.3899 8H15.1499" stroke="currentColor"></path><path d="M11.8115 11.8115L13.0556 13.0556" stroke="currentColor"></path><path d="M8 13.3901V15.1501" stroke="currentColor"></path><path d="M4.18868 11.8115L2.94458 13.0556" stroke="currentColor"></path><path d="M2.6101 8H0.850098" stroke="currentColor"></path><path d="M4.18868 4.18856L2.94458 2.94446" stroke="currentColor"></path><path d="M8 2.6101V0.850098" stroke="currentColor"></path><path d="M11.8115 4.18856L13.0556 2.94446" stroke="currentColor"></path></svg>` },
  "dark-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M14.1127 8.70663C14.2576 8.60602 14.4627 8.71355 14.4386 8.88834C14.2901 9.96567 13.8731 10.9912 13.2229 11.8692C12.479 12.8735 11.4613 13.6421 10.2917 14.0829C9.1222 14.5236 7.85038 14.6179 6.62865 14.3543C5.40692 14.0907 4.28709 13.4805 3.40332 12.5967C2.51955 11.7129 1.90931 10.5931 1.64572 9.37135C1.38212 8.14962 1.47635 6.87779 1.91711 5.70825C2.35787 4.5387 3.12647 3.52103 4.13083 2.77714C5.00878 2.12689 6.03433 1.70994 7.11166 1.5614C7.28645 1.5373 7.39397 1.74238 7.29337 1.88734C6.68703 2.76099 6.37885 3.81241 6.42313 4.88345C6.47392 6.11194 6.98471 7.27645 7.85413 8.14587C8.72355 9.01529 9.88805 9.52608 11.1166 9.57687C12.1876 9.62114 13.239 9.31296 14.1127 8.70663Z" stroke="currentColor"></path></svg>` },
  "followsystem-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V11.5C1.5 12.0523 1.94772 12.5 2.5 12.5H13.5C14.0523 12.5 14.5 12.0523 14.5 11.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor"></path><path d="M5 14.5H11" stroke="currentColor"></path></svg>` },
  "data-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M7.8667 0.349609C8.96906 0.349634 10.0601 0.481272 11.0317 0.735352C11.9973 0.987845 12.8453 1.362 13.4644 1.84766C14.0744 2.32629 14.507 2.95539 14.5161 3.69336H14.5171V8.53516C14.0843 8.32076 13.6108 8.17679 13.1108 8.11816C13.1831 7.96848 13.2162 7.82856 13.2163 7.70312V5.76758C12.6269 6.16618 11.8739 6.47995 11.0317 6.7002C10.0602 6.95423 8.96896 7.08494 7.8667 7.08496C6.76461 7.08493 5.67411 6.95415 4.70264 6.7002C3.85994 6.48006 3.10694 6.1662 2.51709 5.76758V7.70312L2.521 7.78418C2.56374 8.19554 2.93361 8.74414 3.91357 9.23145C4.9281 9.73585 6.35004 10.0371 7.8667 10.0371C8.26373 10.0371 8.6543 10.0141 9.03271 9.97461C8.75596 10.3799 8.54664 10.8349 8.42041 11.3232C8.23666 11.3313 8.0518 11.3369 7.8667 11.3369C6.20108 11.3369 4.57025 11.01 3.33447 10.3955C3.04163 10.2499 2.76658 10.0836 2.51709 9.90039V11.6738C2.51728 12.1379 2.88589 12.7556 3.92236 13.292C4.93457 13.8157 6.35342 14.1289 7.8667 14.1289C8.12318 14.1289 8.37694 14.1161 8.62646 14.0986C8.82021 14.5535 9.08999 14.9682 9.41943 15.3271C8.91285 15.3934 8.39149 15.4287 7.8667 15.4287C6.19761 15.4287 4.56379 15.0869 3.32568 14.4463C2.11244 13.8185 1.21649 12.8562 1.21631 11.6738V3.76367C1.21595 3.74853 1.21438 3.733 1.21436 3.71777C1.21436 2.96917 1.65103 2.33053 2.26807 1.84668C2.88747 1.36112 3.73675 0.987685 4.70264 0.735352C5.67413 0.481376 6.76457 0.349636 7.8667 0.349609ZM7.8667 1.65039C6.86269 1.65042 5.88326 1.77028 5.03076 1.99316C4.17183 2.2176 3.50421 2.52956 3.06982 2.87012C2.65043 3.19909 2.52622 3.48898 2.51709 3.69336V3.74414C2.52719 3.94845 2.65185 4.23772 3.06982 4.56543C3.50425 4.90601 4.17172 5.21795 5.03076 5.44238C5.88326 5.66527 6.8627 5.78513 7.8667 5.78516C8.8707 5.78513 9.85015 5.66525 10.7026 5.44238C11.5611 5.21787 12.2286 4.9049 12.6626 4.56445C13.0982 4.22252 13.2163 3.9231 13.2163 3.71777L13.2104 3.63574C13.1818 3.43623 13.044 3.16941 12.6626 2.87012C12.2286 2.52957 11.5614 2.21773 10.7026 1.99316C9.85009 1.77025 8.8708 1.65041 7.8667 1.65039Z" fill="currentColor"></path><path d="M12.8936 10.0361L13.2061 10.5566C13.2296 10.5959 13.2651 10.6562 13.3027 10.707C13.3469 10.7666 13.4148 10.8431 13.5195 10.9023C13.6244 10.9617 13.725 10.9801 13.7988 10.9873C13.8619 10.9934 13.9318 10.9932 13.9775 10.9932H14.6162L14.8896 11.4502L14.5947 11.9443C14.5698 11.9859 14.5312 12.0483 14.5029 12.1084C14.4781 12.1611 14.4514 12.2312 14.4395 12.3164L14.4326 12.4072L14.4395 12.4971C14.4514 12.5825 14.4781 12.6532 14.5029 12.7061C14.5312 12.7661 14.5689 12.8287 14.5938 12.8701L14.8896 13.3633L14.6162 13.8213H13.9775C13.9318 13.8213 13.8619 13.821 13.7988 13.8271C13.7433 13.8326 13.6728 13.8442 13.5967 13.875L13.5195 13.9121C13.4148 13.9714 13.3469 14.0478 13.3027 14.1074C13.265 14.1583 13.2296 14.2186 13.2061 14.2578L12.8936 14.7783H12.3115L11.999 14.2578C11.9755 14.2186 11.9401 14.1583 11.9023 14.1074C11.8693 14.0628 11.823 14.0083 11.7578 13.959L11.6855 13.9121L11.6074 13.875C11.5316 13.8445 11.4615 13.8325 11.4062 13.8271C11.3432 13.821 11.2733 13.8213 11.2275 13.8213H10.5889L10.3135 13.3633L10.6104 12.8701C10.6352 12.8287 10.6739 12.7661 10.7021 12.7061C10.7352 12.6357 10.7724 12.534 10.7725 12.4072C10.7724 12.2804 10.7352 12.1788 10.7021 12.1084C10.6739 12.0483 10.6353 11.9859 10.6104 11.9443L10.3135 11.4502L10.5889 10.9932H11.2275C11.2733 10.9932 11.3432 10.9934 11.4062 10.9873C11.4801 10.9801 11.5808 10.9616 11.6855 10.9023C11.7903 10.843 11.8582 10.7666 11.9023 10.707C11.94 10.6562 11.9755 10.5959 11.999 10.5566L12.3115 10.0361H12.8936Z" stroke="currentColor" stroke-miterlimit="10"></path></svg>` },
  "database-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z" stroke="currentColor"></path><path d="M2 3.80371V11.7848" stroke="currentColor"></path><path d="M14 3.80371V11.7848" stroke="currentColor"></path><path d="M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396" stroke="currentColor"></path><path d="M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847" stroke="currentColor"></path></svg>` },
  "clock-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor"></path><path d="M8 4.31V8.46L11 10.08" stroke="currentColor"></path></svg>` },
  "gauge-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor"></path><path d="M8 8.49994L11.6114 4.88855" stroke="currentColor"></path><path d="M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z" fill="currentColor"></path></svg>` },
  "send-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.97211 1.94476C7.55785 1.35914 8.50767 1.35919 9.09343 1.94476L13.921 6.77228L13.2138 7.47939L8.38632 2.65187C8.19108 2.45682 7.87443 2.45677 7.67922 2.65187L2.74397 7.58711L2.03687 6.88L6.97211 1.94476Z" fill="currentColor"></path><path d="M7.97571 14.5732L8.02421 2.34139" stroke="currentColor"></path></svg>` },
  "queue-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M5 6.75H11" stroke="currentColor"></path><path d="M5 9H8" stroke="currentColor"></path><path d="M2.37067 11.2497C1.5872 9.89252 1.32042 8.29798 1.61945 6.7597C1.91847 5.22141 2.76317 3.84293 3.99801 2.87809C5.23285 1.91325 6.7747 1.427 8.33964 1.50888C9.90458 1.59076 11.3873 2.23526 12.5147 3.32369C13.6422 4.41232 14.3384 5.8717 14.4751 7.43304C14.6118 8.99438 14.1797 10.5525 13.2585 11.8205C12.3372 13.0885 10.9889 13.9809 9.4617 14.3334C8.18666 14.6277 6.8587 14.529 5.64964 14.0601C5.17095 13.8745 4.76937 13.4929 4.26509 13.3963C3.67389 13.2832 2.95232 13.5595 2.0377 14.3334" stroke="currentColor"></path></svg>` },
  "checklist-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z" stroke="currentColor"></path><path d="M7.5 4.5H13.5" stroke="currentColor"></path><path d="M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z" stroke="currentColor"></path><path d="M7.5 11.5H13.5" stroke="currentColor"></path></svg>` },
  "list-pen-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4.9375 5.90295H11.0625" stroke="currentColor"></path><path d="M4.9375 9.02991H8.27841" stroke="currentColor"></path><path d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V7.61328L13 8.68164V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H8.32812L7.39258 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5Z" fill="currentColor"></path><path d="M8.97212 14.3693C9.17511 14.5723 9.37811 14.7753 9.5811 14.9783C9.67012 14.8953 9.75914 14.8123 9.84815 14.7293C11.4505 13.2352 13.0528 11.7411 14.6551 10.247C14.7441 10.164 14.8331 10.081 14.9221 9.99803C14.5989 9.6748 14.2756 9.35157 13.9524 9.02834C13.8694 9.11736 13.7864 9.20637 13.7034 9.29539C12.2093 10.8977 10.7152 12.5 9.22113 14.1023C9.13813 14.1913 9.05513 14.2803 8.97212 14.3693Z" fill="currentColor"></path><path d="M11.6323 13.7841C11.6323 14.0395 11.6323 14.295 11.6323 14.5504C11.6812 14.5523 11.7301 14.5543 11.779 14.5562C12.659 14.5913 13.539 14.6263 14.419 14.6614C14.4679 14.6633 14.5168 14.6653 14.5657 14.6672C14.5657 14.3339 14.5657 14.0006 14.5657 13.6672C14.5168 13.6692 14.4679 13.6711 14.419 13.6731C13.539 13.7081 12.659 13.7432 11.779 13.7783C11.7301 13.7802 11.6812 13.7821 11.6323 13.7841Z" fill="currentColor"></path></svg>` },
  "goal-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5" stroke="currentColor"></path><path d="M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5" stroke="currentColor"></path><path d="M8.00024 7.99976L11.2 4.80005" stroke="currentColor"></path><path d="M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z" stroke="currentColor"></path></svg>` },
  "sparkle": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z" stroke="currentColor"></path><path d="M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z" stroke="currentColor"></path><path d="M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z" stroke="currentColor"></path></svg>` },
  "inspect-outline": { size: 12, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4.67398 4.25061L1.36094 7.86484C1.29085 7.9413 1.29085 8.05866 1.36094 8.13513L4.67398 11.7494" stroke="currentColor"></path><path d="M11.3262 4.25061L14.6392 7.86484C14.7093 7.9413 14.7093 8.05866 14.6392 8.13513L11.3262 11.7494" stroke="currentColor"></path><path d="M9.56222 3.62573L6.43774 12.3743" stroke="currentColor"></path></svg>` },
  "skill-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 17" fill="none" stroke-width="${strokeWidth}"><path d="M4.57788 5.77124H10.7029" stroke="currentColor"></path><path d="M4.57788 8.89819H7.91879" stroke="currentColor"></path><path d="M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z" fill="currentColor"></path><path d="M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z" stroke="currentColor"></path></svg>` },
  "question-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"></path><path d="M5.75 6.69646C5.75 6.29865 5.88196 5.90976 6.12919 5.57899C6.37643 5.24821 6.72783 4.99041 7.13896 4.83817C7.5501 4.68593 8.0025 4.6461 8.43895 4.72371C8.87541 4.80132 9.27632 4.99289 9.59099 5.27419C9.90566 5.55549 10.12 5.91388 10.2068 6.30406C10.2936 6.69423 10.249 7.09866 10.0787 7.4662C9.90843 7.83373 9.62004 8.14787 9.25003 8.36889C9.19476 8.4019 9.13803 8.43262 9.08004 8.46099C8.52566 8.73217 8 9.20817 8 9.82532" stroke="currentColor"></path><path d="M8 10.7416V11.7416" stroke="currentColor"></path></svg>` },
  "info-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke-width="${strokeWidth}"><path d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z" fill="currentColor"></path><path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z" fill="currentColor"></path><path d="M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor"></path></svg>` },
  "plugin-pinwheel-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942" stroke="currentColor"></path><path d="M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037" stroke="currentColor"></path><path d="M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798" stroke="currentColor"></path><path d="M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723" stroke="currentColor"></path></svg>` },
  "alarm-clock-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 17" fill="none" stroke-width="${strokeWidth}"><path d="M4.09372 11.9895L3.11865 14.0387" stroke="currentColor"></path><path d="M12.1392 11.9895L13.1143 14.0387" stroke="currentColor"></path><path d="M8.11646 4.78442V8.03442L10.6165 9.53442" stroke="currentColor"></path><path d="M8.11646 13.4094C11.154 13.4094 13.6165 10.947 13.6165 7.90942C13.6165 4.87186 11.154 2.40942 8.11646 2.40942C5.07889 2.40942 2.61646 4.87186 2.61646 7.90942C2.61646 10.947 5.07889 13.4094 8.11646 13.4094Z" stroke="currentColor"></path><path d="M1.75952 4.74323C2.30657 3.65639 3.12646 2.73047 4.12926 2.05542" stroke="currentColor"></path><path d="M14.3345 4.74323C13.7874 3.65639 12.9675 2.73047 11.9647 2.05542" stroke="currentColor"></path></svg>` },
  "archive-outline": { size: 20, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor"></path><path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5" stroke="currentColor"></path><path d="M6.5 9.5H9.5" stroke="currentColor"></path></svg>` },
  "wrap-lines-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M2.3457 3.19299H13.6541" stroke="currentColor"></path><path d="M2.3457 7.46497H9.19332" stroke="currentColor"></path><path d="M2.3457 11.7369H6.4849" stroke="currentColor"></path><path d="M9.1936 7.46497H11.5183C12.6981 7.46497 13.6544 8.42132 13.6544 9.60103C13.6544 10.7808 12.6981 11.7371 11.5183 11.7371H9.1936" stroke="currentColor"></path><path d="M10.9505 9.7677L9.12262 11.5956C9.04452 11.6737 9.04452 11.8003 9.12262 11.8784L10.9505 13.7063" stroke="currentColor"></path></svg>` },
  "nowrap-fill": { size: 16, svg: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M2 15H1V1H2V15Z" fill="currentColor"></path><path d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z" fill="currentColor"></path><path d="M15 15H14V1H15V15Z" fill="currentColor"></path></svg>' },
  "wrap-fill": { size: 16, svg: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z" fill="currentColor"></path><path d="M2 15H1V1H2V15Z" fill="currentColor"></path><path d="M15 15H14V1H15V15Z" fill="currentColor"></path></svg>' },
  "compare-split-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H6C6.55228 14.5 7 14.0523 7 13.5V2.5C7 1.94772 6.55228 1.5 6 1.5Z" stroke="currentColor"></path><path d="M13.5 1.5H10C9.44772 1.5 9 1.94772 9 2.5V13.5C9 14.0523 9.44772 14.5 10 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor"></path></svg>` },
  "plan-outline": { size: 14, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M4.9375 5.90295H11.0625" stroke="currentColor"></path><path d="M4.9375 9.02991H8.27841" stroke="currentColor"></path><path d="M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V7.61328L13 8.68164V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H8.32812L7.39258 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5Z" fill="currentColor"></path><path d="M8.97212 14.3693C9.17511 14.5723 9.37811 14.7753 9.5811 14.9783C9.67012 14.8953 9.75914 14.8123 9.84815 14.7293C11.4505 13.2352 13.0528 11.7411 14.6551 10.247C14.7441 10.164 14.8331 10.081 14.9221 9.99803C14.5989 9.6748 14.2756 9.35157 13.9524 9.02834C13.8694 9.11736 13.7864 9.20637 13.7034 9.29539C12.2093 10.8977 10.7152 12.5 9.22113 14.1023C9.13813 14.1913 9.05513 14.2803 8.97212 14.3693Z" fill="currentColor"></path><path d="M11.6323 13.7841C11.6323 14.0395 11.6323 14.295 11.6323 14.5504C11.6812 14.5523 11.7301 14.5543 11.779 14.5562C12.659 14.5913 13.539 14.6263 14.419 14.6614C14.4679 14.6633 14.5168 14.6653 14.5657 14.6672C14.5657 14.3339 14.5657 14.0006 14.5657 13.6672C14.5168 13.6692 14.4679 13.6711 14.419 13.6731C13.539 13.7081 12.659 13.7432 11.779 13.7783C11.7301 13.7802 11.6812 13.7821 11.6323 13.7841Z" fill="currentColor"></path></svg>` },
  "compact-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path opacity="0.35" d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"></path><path d="M8 1.5C8.85359 1.5 9.69883 1.66813 10.4874 1.99478C11.2761 2.32144 11.9926 2.80022 12.5962 3.40381C13.1998 4.00739 13.6786 4.72394 14.0052 5.51256C14.3319 6.30117 14.5 7.14641 14.5 8" stroke="currentColor"></path></svg>` },
  "shield-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z" stroke="currentColor" stroke-linejoin="round"></path></svg>` },
  "check-circle-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M12.5303 6.53027L8.80273 10.2578C8.54967 10.5109 8.31796 10.7439 8.10645 10.9141C7.88375 11.0932 7.616 11.2602 7.27344 11.3145C7.09229 11.3431 6.90771 11.3431 6.72656 11.3145C6.384 11.2602 6.11625 11.0932 5.89355 10.9141C5.68204 10.7439 5.45033 10.5109 5.19727 10.2578L3.46973 8.53027L4.53027 7.46973L6.25781 9.19727C6.53457 9.47402 6.70036 9.63859 6.83398 9.74609C6.95637 9.84453 6.98241 9.83644 6.96094 9.83301C6.98679 9.83709 7.01321 9.83709 7.03906 9.83301C7.01759 9.83644 7.04363 9.84453 7.16602 9.74609C7.29964 9.63859 7.46543 9.47402 7.74219 9.19727L11.4697 5.46973L12.5303 6.53027Z" fill="currentColor"></path><path d="M14.5996 8C14.5996 4.35492 11.6451 1.40039 8 1.40039C4.35492 1.40039 1.40039 4.35492 1.40039 8C1.40039 11.6451 4.35492 14.5996 8 14.5996C11.6451 14.5996 14.5996 11.6451 14.5996 8ZM15.9004 8C15.9004 12.363 12.363 15.9004 8 15.9004C3.63695 15.9004 0.0996094 12.363 0.0996094 8C0.0996094 3.63695 3.63695 0.0996094 8 0.0996094C12.363 0.0996094 15.9004 3.63695 15.9004 8Z" fill="currentColor"></path></svg>` },
  "unarchive-outline": { size: 20, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke-width="${strokeWidth}"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z" fill="currentColor"></path><path d="M10 14.1V10.1M7.85 12.05L10 9.9L12.15 12.05" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>` },
  "pin-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" stroke="currentColor" stroke-linejoin="round"></path><path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="currentColor"></path></svg>` },
  "pin-fill": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="${strokeWidth}"><path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"></path><path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="currentColor"></path></svg>` },
  "flat-list-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="${strokeWidth}"><path d="M6 3.5h7.5M6 8h7.5M6 12.5h7.5"></path><path d="M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01"></path></svg>` },
  "workspace-tree-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><path d="M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z"></path><path d="M8.7 8.1v3M11.2 8.1v3"></path></svg>` },
  "chevrons-up-down-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><path d="m5.1 6 2.9-2.9L10.9 6"></path><path d="m5.1 10 2.9 2.9 2.9-2.9"></path></svg>` },
  "drag-handle-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="${strokeWidth}"><path d="M4 5h8M4 8h8M4 11h8"></path></svg>` },
  "archive-off-outline": { size: 16, svg: (strokeWidth) => strokeWidth === ICON_MEDIUM_STROKE ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><mask id="dsw-icon-archive-off-outline-medium-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect x="0" y="0" width="16" height="16" fill="white" stroke="none"></rect><path d="m2.2 1.3 11.6 12.8" stroke="black" stroke-width="4.3"></path></mask><g mask="url(#dsw-icon-archive-off-outline-medium-mask)"><rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1"></rect><path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7"></path></g><path d="m2.2 1.3 11.6 12.8"></path></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><mask id="dsw-icon-archive-off-outline-regular-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect x="0" y="0" width="16" height="16" fill="white" stroke="none"></rect><path d="m2.2 1.3 11.6 12.8" stroke="black" stroke-width="4"></path></mask><g mask="url(#dsw-icon-archive-off-outline-regular-mask)"><rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1"></rect><path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7"></path></g><path d="m2.2 1.3 11.6 12.8"></path></svg>` },
  "archive-check-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"><rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1"></rect><path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7"></path><path d="m6 9.35 1.4 1.4 2.6-2.6"></path></svg>` },
  "sliders-two-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="${strokeWidth}"><path d="M2.3 5h5.85M12.05 5h1.65"></path><circle cx="9.95" cy="5" r="1.45"></circle><path d="M2.3 11h1.65M7.85 11h5.85"></path><circle cx="5.75" cy="11" r="1.45"></circle></svg>` },
  "microphone-outline": { size: 16, svg: (strokeWidth) => strokeWidth === ICON_MEDIUM_STROKE ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"><rect x="5.15" y="1.65" width="5.7" height="8.7" rx="2.85"></rect><path d="M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15"></path></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"><rect x="5" y="1.5" width="6" height="9" rx="3"></rect><path d="M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15"></path></svg>` },
  "apps-add-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"><rect x="2.25" y="2.25" width="4" height="4" rx="1"></rect><rect x="2.25" y="9.75" width="4" height="4" rx="1"></rect><rect x="9.75" y="9.75" width="4" height="4" rx="1"></rect><path d="M11.75 1.75v5M9.25 4.25h5"></path></svg>` },
  "apps-add-compact-outline": { size: 16, svg: (strokeWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"><rect x="2.75" y="2.75" width="4" height="4" rx="1"></rect><rect x="2.75" y="9.25" width="4" height="4" rx="1"></rect><rect x="9.25" y="9.25" width="4" height="4" rx="1"></rect><path d="M11.25 2.25v5M8.75 4.75h5"></path></svg>` }
};
var STROKES = { regular: ICON_REGULAR_STROKE, medium: ICON_MEDIUM_STROKE };
function iconSymbolId(glyph, weight) {
  return `dsw-icon-${glyph}-${weight}`;
}
var ICON_SYMBOLS = Object.freeze(Object.fromEntries(
  Object.entries(ICON_ARTWORK).flatMap(([glyph, artwork]) => Object.keys(STROKES).map((weight) => [iconSymbolId(glyph, weight), artwork.svg(STROKES[weight])]))
));

// deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
function productIcon(glyph, weight) {
  const { size: defaultSize, aspect: [width, height] = [1, 1] } = ICON_ARTWORK[glyph];
  const id = iconSymbolId(glyph, weight);
  return ({ size = defaultSize, className }) => /* @__PURE__ */ jsx2("svg", { width: size * width / height, height: size, className, "data-icon": id, "aria-hidden": "true", children: /* @__PURE__ */ jsx2("use", { href: `#${id}` }) });
}
var IconLayersOutlineRegular = productIcon("layers-outline", "regular");
var IconLayersOutlineMedium = productIcon("layers-outline", "medium");
var IconNewChatOutlineRegular = productIcon("new-chat-outline", "regular");
var IconNewChatOutlineMedium = productIcon("new-chat-outline", "medium");
var IconSearchOutlineRegular = productIcon("search-outline", "regular");
var IconSearchOutlineMedium = productIcon("search-outline", "medium");
var IconEyeOutlineRegular = productIcon("eye-outline", "regular");
var IconEyeOutlineMedium = productIcon("eye-outline", "medium");
var IconEyeOffOutlineRegular = productIcon("eye-off-outline", "regular");
var IconEyeOffOutlineMedium = productIcon("eye-off-outline", "medium");
var IconGlobeOutlineRegular = productIcon("globe-outline", "regular");
var IconGlobeOutlineMedium = productIcon("globe-outline", "medium");
var IconSettingsOutlineRegular = productIcon("settings-outline", "regular");
var IconSettingsOutlineMedium = productIcon("settings-outline", "medium");
var IconPanelLeftOutlineRegular = productIcon("panel-left-outline", "regular");
var IconPanelLeftOutlineMedium = productIcon("panel-left-outline", "medium");
var IconEllipsisOutlineRegular = productIcon("ellipsis-outline", "regular");
var IconEllipsisOutlineMedium = productIcon("ellipsis-outline", "medium");
var IconPlusOutlineRegular = productIcon("plus-outline", "regular");
var IconPlusOutlineMedium = productIcon("plus-outline", "medium");
var IconCheckOutlineRegular = productIcon("check-outline", "regular");
var IconCheckOutlineMedium = productIcon("check-outline", "medium");
var IconMailUnreadOutlineRegular = productIcon("mail-unread-outline", "regular");
var IconMailUnreadOutlineMedium = productIcon("mail-unread-outline", "medium");
var IconMailReadOutlineRegular = productIcon("mail-read-outline", "regular");
var IconMailReadOutlineMedium = productIcon("mail-read-outline", "medium");
var IconBranchOutlineRegular = productIcon("branch-outline", "regular");
var IconBranchOutlineMedium = productIcon("branch-outline", "medium");
var IconChevronDownOutlineRegular = productIcon("chevron-down-outline", "regular");
var IconChevronDownOutlineMedium = productIcon("chevron-down-outline", "medium");
var IconChevronLeftOutlineRegular = productIcon("chevron-left-outline", "regular");
var IconChevronLeftOutlineMedium = productIcon("chevron-left-outline", "medium");
var IconChevronRightOutlineRegular = productIcon("chevron-right-outline", "regular");
var IconChevronRightOutlineMedium = productIcon("chevron-right-outline", "medium");
var IconTriangleRightFillRegular = productIcon("triangle-right-fill", "regular");
var IconTriangleRightFillMedium = productIcon("triangle-right-fill", "medium");
var IconChevronUpOutlineRegular = productIcon("chevron-up-outline", "regular");
var IconChevronUpOutlineMedium = productIcon("chevron-up-outline", "medium");
var IconCloseOutlineRegular = productIcon("close-outline", "regular");
var IconCloseOutlineMedium = productIcon("close-outline", "medium");
var IconCloseFillRegular = productIcon("close-fill", "regular");
var IconCloseFillMedium = productIcon("close-fill", "medium");
var IconCloseCircleFillRegular = productIcon("close-circle-fill", "regular");
var IconCloseCircleFillMedium = productIcon("close-circle-fill", "medium");
var IconCopyOutlineRegular = productIcon("copy-outline", "regular");
var IconCopyOutlineMedium = productIcon("copy-outline", "medium");
var IconRefreshOutlineRegular = productIcon("refresh-outline", "regular");
var IconRefreshOutlineMedium = productIcon("refresh-outline", "medium");
var IconLikeOutlineRegular = productIcon("like-outline", "regular");
var IconLikeOutlineMedium = productIcon("like-outline", "medium");
var IconLikeFillRegular = productIcon("like-fill", "regular");
var IconLikeFillMedium = productIcon("like-fill", "medium");
var IconDislikeOutlineRegular = productIcon("dislike-outline", "regular");
var IconDislikeOutlineMedium = productIcon("dislike-outline", "medium");
var IconDislikeFillRegular = productIcon("dislike-fill", "regular");
var IconDislikeFillMedium = productIcon("dislike-fill", "medium");
var IconShareOutlineRegular = productIcon("share-outline", "regular");
var IconShareOutlineMedium = productIcon("share-outline", "medium");
var IconDeliverDocRegular = productIcon("deliver-doc", "regular");
var IconDeliverDocMedium = productIcon("deliver-doc", "medium");
var IconEditOutlineRegular = productIcon("edit-outline", "regular");
var IconEditOutlineMedium = productIcon("edit-outline", "medium");
var IconThinkOutlineRegular = productIcon("think-outline", "regular");
var IconThinkOutlineMedium = productIcon("think-outline", "medium");
var IconAgentPresetOutlineRegular = productIcon("agent-preset-outline", "regular");
var IconAgentPresetOutlineMedium = productIcon("agent-preset-outline", "medium");
var IconBrowseOutlineRegular = productIcon("browse-outline", "regular");
var IconBrowseOutlineMedium = productIcon("browse-outline", "medium");
var IconContextInjectionOutlineRegular = productIcon("context-injection-outline", "regular");
var IconContextInjectionOutlineMedium = productIcon("context-injection-outline", "medium");
var IconLinkOutlineRegular = productIcon("link-outline", "regular");
var IconLinkOutlineMedium = productIcon("link-outline", "medium");
var IconRightUpOutlineRegular = productIcon("right-up-outline", "regular");
var IconRightUpOutlineMedium = productIcon("right-up-outline", "medium");
var IconEnhanceOutlineRegular = productIcon("enhance-outline", "regular");
var IconEnhanceOutlineMedium = productIcon("enhance-outline", "medium");
var IconTrashOutlineRegular = productIcon("trash-outline", "regular");
var IconTrashOutlineMedium = productIcon("trash-outline", "medium");
var IconWarningOutlineRegular = productIcon("warning-outline", "regular");
var IconWarningOutlineMedium = productIcon("warning-outline", "medium");
var IconCheckCircleFillRegular = productIcon("check-circle-fill", "regular");
var IconCheckCircleFillMedium = productIcon("check-circle-fill", "medium");
var IconWarningTriangleOutlineRegular = productIcon("warning-triangle-outline", "regular");
var IconWarningTriangleOutlineMedium = productIcon("warning-triangle-outline", "medium");
var IconUserOutlineRegular = productIcon("user-outline", "regular");
var IconUserOutlineMedium = productIcon("user-outline", "medium");
var IconUsersOutlineRegular = productIcon("users-outline", "regular");
var IconUsersOutlineMedium = productIcon("users-outline", "medium");
var IconPaperPlaneOutlineRegular = productIcon("paper-plane-outline", "regular");
var IconPaperPlaneOutlineMedium = productIcon("paper-plane-outline", "medium");
var IconStopFillRegular = productIcon("stop-fill", "regular");
var IconStopFillMedium = productIcon("stop-fill", "medium");
var IconPaperclipOutlineRegular = productIcon("paperclip-outline", "regular");
var IconPaperclipOutlineMedium = productIcon("paperclip-outline", "medium");
var IconLoadingOutlineRegular = productIcon("loading-outline", "regular");
var IconLoadingOutlineMedium = productIcon("loading-outline", "medium");
var IconDownloadOutlineRegular = productIcon("download-outline", "regular");
var IconDownloadOutlineMedium = productIcon("download-outline", "medium");
var IconUploadOutlineRegular = productIcon("upload-outline", "regular");
var IconUploadOutlineMedium = productIcon("upload-outline", "medium");
var IconPlayOutlineRegular = productIcon("play-outline", "regular");
var IconPlayOutlineMedium = productIcon("play-outline", "medium");
var IconPauseOutlineRegular = productIcon("pause-outline", "regular");
var IconPauseOutlineMedium = productIcon("pause-outline", "medium");
var IconFullscreenOutlineRegular = productIcon("fullscreen-outline", "regular");
var IconFullscreenOutlineMedium = productIcon("fullscreen-outline", "medium");
var IconCodeOutlineRegular = productIcon("code-outline", "regular");
var IconCodeOutlineMedium = productIcon("code-outline", "medium");
var IconCordisPluginOutlineRegular = productIcon("cordis-plugin-outline", "regular");
var IconCordisPluginOutlineMedium = productIcon("cordis-plugin-outline", "medium");
var IconApiOutlineRegular = productIcon("api-outline", "regular");
var IconApiOutlineMedium = productIcon("api-outline", "medium");
var IconPersonalizationOutlineRegular = productIcon("personalization-outline", "regular");
var IconPersonalizationOutlineMedium = productIcon("personalization-outline", "medium");
var IconProjectAddOutlineRegular = productIcon("project-add-outline", "regular");
var IconProjectAddOutlineMedium = productIcon("project-add-outline", "medium");
var IconFolderOpenOutlineRegular = productIcon("folder-open-outline", "regular");
var IconFolderOpenOutlineMedium = productIcon("folder-open-outline", "medium");
var IconFolderOpenRegular = productIcon("folder-open", "regular");
var IconFolderOpenMedium = productIcon("folder-open", "medium");
var IconFolderCloseRegular = productIcon("folder-close", "regular");
var IconFolderCloseMedium = productIcon("folder-close", "medium");
var IconTreeCornerRegular = productIcon("tree-corner", "regular");
var IconTreeCornerMedium = productIcon("tree-corner", "medium");
var IconLightOutlineRegular = productIcon("light-outline", "regular");
var IconLightOutlineMedium = productIcon("light-outline", "medium");
var IconDarkOutlineRegular = productIcon("dark-outline", "regular");
var IconDarkOutlineMedium = productIcon("dark-outline", "medium");
var IconFollowsystemOutlineRegular = productIcon("followsystem-outline", "regular");
var IconFollowsystemOutlineMedium = productIcon("followsystem-outline", "medium");
var IconDataOutlineRegular = productIcon("data-outline", "regular");
var IconDataOutlineMedium = productIcon("data-outline", "medium");
var IconDatabaseOutlineRegular = productIcon("database-outline", "regular");
var IconDatabaseOutlineMedium = productIcon("database-outline", "medium");
var IconClockOutlineRegular = productIcon("clock-outline", "regular");
var IconClockOutlineMedium = productIcon("clock-outline", "medium");
var IconGaugeOutlineRegular = productIcon("gauge-outline", "regular");
var IconGaugeOutlineMedium = productIcon("gauge-outline", "medium");
var IconSendOutlineRegular = productIcon("send-outline", "regular");
var IconSendOutlineMedium = productIcon("send-outline", "medium");
var IconQueueOutlineRegular = productIcon("queue-outline", "regular");
var IconQueueOutlineMedium = productIcon("queue-outline", "medium");
var IconChecklistOutlineRegular = productIcon("checklist-outline", "regular");
var IconChecklistOutlineMedium = productIcon("checklist-outline", "medium");
var IconListPenOutlineRegular = productIcon("list-pen-outline", "regular");
var IconListPenOutlineMedium = productIcon("list-pen-outline", "medium");
var IconGoalOutlineRegular = productIcon("goal-outline", "regular");
var IconGoalOutlineMedium = productIcon("goal-outline", "medium");
var IconSparkleRegular = productIcon("sparkle", "regular");
var IconSparkleMedium = productIcon("sparkle", "medium");
var IconInspectOutlineRegular = productIcon("inspect-outline", "regular");
var IconInspectOutlineMedium = productIcon("inspect-outline", "medium");
var IconSkillOutlineRegular = productIcon("skill-outline", "regular");
var IconSkillOutlineMedium = productIcon("skill-outline", "medium");
var IconQuestionOutlineRegular = productIcon("question-outline", "regular");
var IconQuestionOutlineMedium = productIcon("question-outline", "medium");
var IconInfoOutlineRegular = productIcon("info-outline", "regular");
var IconInfoOutlineMedium = productIcon("info-outline", "medium");
var IconPluginPinwheelOutlineRegular = productIcon("plugin-pinwheel-outline", "regular");
var IconPluginPinwheelOutlineMedium = productIcon("plugin-pinwheel-outline", "medium");
var IconAlarmClockOutlineRegular = productIcon("alarm-clock-outline", "regular");
var IconAlarmClockOutlineMedium = productIcon("alarm-clock-outline", "medium");
var IconArchiveOutlineRegular = productIcon("archive-outline", "regular");
var IconArchiveOutlineMedium = productIcon("archive-outline", "medium");
var IconWrapLinesOutlineRegular = productIcon("wrap-lines-outline", "regular");
var IconWrapLinesOutlineMedium = productIcon("wrap-lines-outline", "medium");
var IconNowrapFillRegular = productIcon("nowrap-fill", "regular");
var IconNowrapFillMedium = productIcon("nowrap-fill", "medium");
var IconWrapFillRegular = productIcon("wrap-fill", "regular");
var IconWrapFillMedium = productIcon("wrap-fill", "medium");
var IconCompareSplitOutlineRegular = productIcon("compare-split-outline", "regular");
var IconCompareSplitOutlineMedium = productIcon("compare-split-outline", "medium");
var IconPlanOutlineRegular = productIcon("plan-outline", "regular");
var IconPlanOutlineMedium = productIcon("plan-outline", "medium");
var IconCompactOutlineRegular = productIcon("compact-outline", "regular");
var IconCompactOutlineMedium = productIcon("compact-outline", "medium");
var IconShieldOutlineRegular = productIcon("shield-outline", "regular");
var IconShieldOutlineMedium = productIcon("shield-outline", "medium");
var IconCheckCircleOutlineRegular = productIcon("check-circle-outline", "regular");
var IconCheckCircleOutlineMedium = productIcon("check-circle-outline", "medium");
var IconUnarchiveOutlineRegular = productIcon("unarchive-outline", "regular");
var IconUnarchiveOutlineMedium = productIcon("unarchive-outline", "medium");
var IconPinOutlineRegular = productIcon("pin-outline", "regular");
var IconPinOutlineMedium = productIcon("pin-outline", "medium");
var IconPinFillRegular = productIcon("pin-fill", "regular");
var IconPinFillMedium = productIcon("pin-fill", "medium");
var IconFlatListOutlineRegular = productIcon("flat-list-outline", "regular");
var IconFlatListOutlineMedium = productIcon("flat-list-outline", "medium");
var IconWorkspaceTreeOutlineRegular = productIcon("workspace-tree-outline", "regular");
var IconWorkspaceTreeOutlineMedium = productIcon("workspace-tree-outline", "medium");
var IconChevronsUpDownOutlineRegular = productIcon("chevrons-up-down-outline", "regular");
var IconChevronsUpDownOutlineMedium = productIcon("chevrons-up-down-outline", "medium");
var IconDragHandleOutlineRegular = productIcon("drag-handle-outline", "regular");
var IconDragHandleOutlineMedium = productIcon("drag-handle-outline", "medium");
var IconArchiveOffOutlineRegular = productIcon("archive-off-outline", "regular");
var IconArchiveOffOutlineMedium = productIcon("archive-off-outline", "medium");
var IconArchiveCheckOutlineRegular = productIcon("archive-check-outline", "regular");
var IconArchiveCheckOutlineMedium = productIcon("archive-check-outline", "medium");
var IconSlidersTwoOutlineRegular = productIcon("sliders-two-outline", "regular");
var IconSlidersTwoOutlineMedium = productIcon("sliders-two-outline", "medium");
var IconMicrophoneOutlineRegular = productIcon("microphone-outline", "regular");
var IconMicrophoneOutlineMedium = productIcon("microphone-outline", "medium");
function appsAddIcon(weight) {
  const Wide = productIcon("apps-add-outline", weight);
  const Compact = productIcon("apps-add-compact-outline", weight);
  return ({ compact = false, ...props }) => compact ? /* @__PURE__ */ jsx2(Compact, { ...props }) : /* @__PURE__ */ jsx2(Wide, { ...props });
}
var IconAppsAddOutlineRegular = appsAddIcon("regular");
var IconAppsAddOutlineMedium = appsAddIcon("medium");
var IconSaveOutlineRegular = productIcon("save-outline", "regular");
var IconSaveOutlineMedium = productIcon("save-outline", "medium");

// deepseek-harness/packages/client/ui-primitives/src/Modal.tsx
import { useRef as useRef2 } from "react";
import { createPortal } from "react-dom";

// deepseek-harness/packages/client/ui-primitives/src/useModalLayer.ts
import { useLayoutEffect, useRef } from "react";

// deepseek-harness/packages/client/ui-primitives/src/keyboard-composition.ts
function observeComposition(document2) {
  let composing = false;
  let ended = false;
  const start = () => {
    composing = true;
  };
  const end = () => {
    composing = false;
    ended = true;
  };
  const release = () => {
    ended = false;
  };
  const blur = () => {
    composing = false;
    ended = false;
  };
  document2.addEventListener("compositionstart", start, true);
  document2.addEventListener("compositionend", end, true);
  document2.addEventListener("keyup", release, true);
  document2.defaultView?.addEventListener("blur", blur);
  return {
    guards: (event) => {
      const guarded = composing || ended || event.isComposing || event.keyCode === 229;
      ended = false;
      return guarded;
    },
    dispose: () => {
      document2.removeEventListener("compositionstart", start, true);
      document2.removeEventListener("compositionend", end, true);
      document2.removeEventListener("keyup", release, true);
      document2.defaultView?.removeEventListener("blur", blur);
    }
  };
}

// deepseek-harness/packages/client/ui-primitives/src/focus.ts
var releases = /* @__PURE__ */ new WeakMap();
var navigationKeys = /* @__PURE__ */ new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
function focusWithoutRing(element, options) {
  releases.get(element)?.();
  const release = () => {
    element.removeAttribute("data-dsh-automatic-focus");
    element.removeEventListener("blur", release);
    element.removeEventListener("keydown", navigate, true);
    releases.delete(element);
  };
  const navigate = (event) => {
    if (!event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && navigationKeys.has(event.key)) release();
  };
  releases.set(element, release);
  element.setAttribute("data-dsh-automatic-focus", "");
  element.addEventListener("blur", release);
  element.addEventListener("keydown", navigate, true);
  element.focus(options);
  if (!element.matches(":focus")) release();
}

// deepseek-harness/packages/client/ui-primitives/src/useModalLayer.ts
var layers = /* @__PURE__ */ new WeakMap();
function isBehindModal(anchor) {
  if (anchor === null) return false;
  const top = layers.get(anchor.ownerDocument)?.at(-1);
  return top !== void 0 && !top.element.contains(anchor);
}
var focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
function useModalLayer(dialog, open, onClose) {
  const close = useRef(onClose);
  const pendingRestore = useRef(void 0);
  close.current = onClose;
  useLayoutEffect(() => {
    const target = pendingRestore.current;
    pendingRestore.current = void 0;
    const element = dialog.current;
    if (!open && element?.contains(element.ownerDocument.activeElement) && target?.isConnected && !target.closest("[inert], [hidden]") && !isBehindModal(target)) {
      focusWithoutRing(target, { preventScroll: true });
    }
    if (!open || element === null) return;
    const document2 = element.ownerDocument;
    const composition = observeComposition(document2);
    const previous = document2.activeElement;
    const stack = layers.get(document2) ?? [];
    layers.set(document2, stack);
    const layer = { element, close: () => {
      close.current();
    } };
    stack.push(layer);
    const initial = element.querySelector("[data-modal-autofocus]") ?? element.querySelector(focusable) ?? element;
    if (!element.contains(document2.activeElement)) focusWithoutRing(initial);
    const keydown = (event) => {
      const composing = composition.guards(event);
      if (stack.at(-1) !== layer || event.defaultPrevented || composing || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape" && !event.shiftKey) {
        event.preventDefault();
        if (!event.repeat) close.current();
      }
      if (event.key !== "Tab") return;
      if (document2.activeElement?.closest('[role="menu"]')) return;
      const items = [...element.querySelectorAll(focusable)].filter((item) => !item.closest("[inert], [hidden]"));
      const first = items[0] ?? element;
      const last = items.at(-1) ?? element;
      const atEdge = event.shiftKey ? document2.activeElement === first : document2.activeElement === last;
      if (document2.activeElement === element || !element.contains(document2.activeElement) || atEdge) {
        event.preventDefault();
        const target2 = event.shiftKey ? last : first;
        target2.focus();
      }
    };
    document2.addEventListener("keydown", keydown);
    return () => {
      composition.dispose();
      const wasTop = stack.at(-1) === layer;
      stack.splice(stack.indexOf(layer), 1);
      document2.removeEventListener("keydown", keydown);
      if (stack.length === 0) layers.delete(document2);
      if (wasTop) {
        const target2 = previous instanceof HTMLElement && previous.isConnected ? previous : stack.at(-1)?.element;
        if (target2 !== void 0) {
          pendingRestore.current = target2;
          focusWithoutRing(target2);
        }
      }
    };
  }, [dialog, open]);
}

// deepseek-harness/packages/client/ui-primitives/src/Modal.module.css
var Modal_default = {
  root: "Modal_root",
  mask: "Modal_mask",
  modalEnter: "Modal_modalEnter",
  dialog: "Modal_dialog",
  content: "Modal_content",
  header: "Modal_header",
  title: "Modal_title",
  warning: "Modal_warning",
  warningIcon: "Modal_warningIcon",
  body: "Modal_body",
  close: "Modal_close",
  description: "Modal_description",
  footer: "Modal_footer"
};

// deepseek-harness/packages/client/ui-primitives/src/Modal.tsx
import { Fragment, jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function Modal({
  open,
  onClose,
  title,
  closeLabel,
  description,
  children,
  footer,
  className,
  contentClassName,
  onKeyDownCapture,
  headless = false,
  backdropBlur = true,
  shortcutModal,
  tone
}) {
  const dialog = useRef2(null);
  useModalLayer(dialog, open, onClose);
  if (!open) return null;
  return createPortal(/* @__PURE__ */ jsxs2("div", { className: Modal_default.root, role: "presentation", onKeyDownCapture, children: [
    /* @__PURE__ */ jsx3("div", { className: Modal_default.mask, style: backdropBlur ? void 0 : { backdropFilter: "none" }, "aria-hidden": "true", onClick: onClose }),
    /* @__PURE__ */ jsx3(
      "div",
      {
        ref: dialog,
        tabIndex: -1,
        "data-shortcut-modal": shortcutModal,
        className: clsx_default(Modal_default.dialog, !headless && tone === "warning" && Modal_default.warning, className),
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title,
        children: headless ? children : /* @__PURE__ */ jsxs2(Fragment, { children: [
          /* @__PURE__ */ jsxs2("div", { className: clsx_default(Modal_default.content, contentClassName), children: [
            /* @__PURE__ */ jsxs2("div", { className: Modal_default.header, children: [
              /* @__PURE__ */ jsxs2("h2", { className: Modal_default.title, children: [
                tone === "warning" && /* @__PURE__ */ jsx3(IconWarningOutlineRegular, { size: 18, className: Modal_default.warningIcon, "aria-hidden": "true" }),
                title
              ] }),
              /* @__PURE__ */ jsx3("button", { type: "button", className: Modal_default.close, "aria-label": closeLabel, onClick: onClose, children: /* @__PURE__ */ jsx3(IconCloseOutlineRegular, { size: 14 }) })
            ] }),
            description !== void 0 && description !== "" && /* @__PURE__ */ jsx3("p", { className: Modal_default.description, children: description }),
            children !== void 0 && /* @__PURE__ */ jsx3("div", { className: Modal_default.body, children })
          ] }),
          footer !== void 0 && /* @__PURE__ */ jsx3("div", { className: Modal_default.footer, children: footer })
        ] })
      }
    )
  ] }), document.body);
}

// deepseek-harness/packages/client/ui-primitives/src/SegmentedControl.tsx
import { useEffect, useRef as useRef3 } from "react";

// deepseek-harness/packages/client/ui-primitives/src/SegmentedControl.module.css
var SegmentedControl_default = {
  control: "SegmentedControl_control",
  indicator: "SegmentedControl_indicator",
  tab: "SegmentedControl_tab"
};

// deepseek-harness/packages/client/ui-primitives/src/SegmentedControl.tsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
function isWalkKey(key) {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}
function walk(options, from2, key) {
  const enabled = options.filter((option) => option.disabled !== true);
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const count = options.length;
  for (let offset = 1; offset < count; offset += 1) {
    const candidate = options[((from2 + step * offset) % count + count) % count];
    if (candidate !== void 0 && candidate.disabled !== true) return candidate;
  }
  return void 0;
}
function SegmentedControl({
  id,
  value,
  options,
  onChange,
  label,
  disabled = false,
  className
}) {
  const list = useRef3(null);
  const selected = options.findIndex((option) => option.value === value);
  useEffect(() => {
    const root = list.current;
    if (root === null) return;
    if (!root.contains(document.activeElement)) return;
    root.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }, [value]);
  const onKeyDown = (event) => {
    if (!isWalkKey(event.key)) return;
    event.preventDefault();
    const target = walk(options, selected, event.key);
    if (target !== void 0 && target.value !== value) onChange(target.value);
  };
  const indicator = {
    "--dsh-segment-count": String(options.length),
    "--dsh-segment-index": String(selected)
  };
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      ref: list,
      role: "tablist",
      "aria-label": label,
      className: clsx_default(SegmentedControl_default.control, className),
      style: indicator,
      children: [
        /* @__PURE__ */ jsx4("span", { "aria-hidden": "true", className: SegmentedControl_default.indicator }),
        options.map((option) => {
          const active = option.value === value;
          return /* @__PURE__ */ jsx4(
            "button",
            {
              id: `${id}-${option.value}`,
              type: "button",
              role: "tab",
              "aria-selected": active,
              "aria-controls": `${id}-${option.value}-panel`,
              tabIndex: active ? 0 : -1,
              disabled: disabled || option.disabled === true,
              title: option.title,
              className: SegmentedControl_default.tab,
              onClick: () => {
                if (!active) onChange(option.value);
              },
              onKeyDown,
              children: option.label
            },
            option.value
          );
        })
      ]
    }
  );
}

// deepseek-harness/packages/client/ui-settings-models/src/client/CustomProviderCard.tsx
import { useEffect as useEffect6, useState as useState6 } from "react";

// deepseek-harness/packages/client/ui-settings-models/src/client/apiKey.ts
var LEGAL_API_KEY = /^[\x21-\x7E]+$/;
var ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;
function isQuoted(value) {
  const first = value[0];
  if (first !== '"' && first !== "'" && first !== "`") return false;
  return value.length > 1 && value.endsWith(first);
}
function apiKeyFailure(draft) {
  if (draft.length === 0) return void 0;
  const value = draft.trim();
  if (value.length === 0) return "keyBlank";
  if (ENV_LINE.test(value) || isQuoted(value)) return "keyIllegalCharacters";
  if (!LEGAL_API_KEY.test(value)) return "keyIllegalCharacters";
  return void 0;
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ApiKeyInput.tsx
import { useState } from "react";

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelsSection.module.css
var ModelsSection_default = {
  section: "ModelsSection_section",
  title: "ModelsSection_title",
  intro: "ModelsSection_intro",
  notice: "ModelsSection_notice",
  savedNotice: "ModelsSection_savedNotice",
  rows: "ModelsSection_rows",
  rowCard: "ModelsSection_rowCard",
  rowHead: "ModelsSection_rowHead",
  rowIdentity: "ModelsSection_rowIdentity",
  rowName: "ModelsSection_rowName",
  rowTag: "ModelsSection_rowTag",
  credentialDot: "ModelsSection_credentialDot",
  credentialDotConfigured: "ModelsSection_credentialDotConfigured",
  credentialDotMissing: "ModelsSection_credentialDotMissing",
  accountStatus: "ModelsSection_accountStatus",
  rowActions: "ModelsSection_rowActions",
  primaryButton: "ModelsSection_primaryButton",
  secondaryButton: "ModelsSection_secondaryButton",
  addButton: "ModelsSection_addButton",
  dangerButton: "ModelsSection_dangerButton",
  linkButton: "ModelsSection_linkButton",
  addModelButton: "ModelsSection_addModelButton",
  iconButton: "ModelsSection_iconButton",
  customizedSummary: "ModelsSection_customizedSummary",
  editor: "ModelsSection_editor",
  editorHeader: "ModelsSection_editorHeader",
  editorTitle: "ModelsSection_editorTitle",
  editorRoute: "ModelsSection_editorRoute",
  field: "ModelsSection_field",
  fieldLabel: "ModelsSection_fieldLabel",
  helpButton: "ModelsSection_helpButton",
  advancedHint: "ModelsSection_advancedHint",
  editorActions: "ModelsSection_editorActions",
  addBlock: "ModelsSection_addBlock",
  addActions: "ModelsSection_addActions",
  addModes: "ModelsSection_addModes",
  addPanel: "ModelsSection_addPanel",
  addCard: "ModelsSection_addCard",
  setupCard: "ModelsSection_setupCard",
  customized: "ModelsSection_customized",
  retryFold: "ModelsSection_retryFold",
  customizedBody: "ModelsSection_customizedBody",
  modelCatalog: "ModelsSection_modelCatalog",
  modelCatalogHeading: "ModelsSection_modelCatalogHeading",
  modelCatalogTitle: "ModelsSection_modelCatalogTitle",
  modelCatalogMeta: "ModelsSection_modelCatalogMeta",
  modelEmpty: "ModelsSection_modelEmpty",
  modelList: "ModelsSection_modelList",
  modelListHead: "ModelsSection_modelListHead",
  modelEntry: "ModelsSection_modelEntry",
  "model-row": "ModelsSection_model-row",
  modelRow: "ModelsSection_modelRow",
  modelName: "ModelsSection_modelName",
  modelNameLabel: "ModelsSection_modelNameLabel",
  modelDragHandle: "ModelsSection_modelDragHandle",
  modelDragPreview: "ModelsSection_modelDragPreview",
  iconButtonDanger: "ModelsSection_iconButtonDanger",
  modelAdvanced: "ModelsSection_modelAdvanced",
  retryBody: "ModelsSection_retryBody",
  retryCodeChoices: "ModelsSection_retryCodeChoices",
  retryCodeAdd: "ModelsSection_retryCodeAdd",
  retryCount: "ModelsSection_retryCount",
  retryBackoff: "ModelsSection_retryBackoff",
  modelField: "ModelsSection_modelField",
  modelInputTypes: "ModelsSection_modelInputTypes",
  modelInputChoices: "ModelsSection_modelInputChoices",
  modelFieldLabel: "ModelsSection_modelFieldLabel",
  modelReasoning: "ModelsSection_modelReasoning",
  modelReasoningLabel: "ModelsSection_modelReasoningLabel",
  modelReasoningHead: "ModelsSection_modelReasoningHead",
  modelReasoningRow: "ModelsSection_modelReasoningRow",
  selectInput: "ModelsSection_selectInput",
  modelReasoningValueInput: "ModelsSection_modelReasoningValueInput",
  input: "ModelsSection_input",
  keyInput: "ModelsSection_keyInput",
  savedKeyInput: "ModelsSection_savedKeyInput",
  keyInputFilled: "ModelsSection_keyInputFilled",
  keyToggle: "ModelsSection_keyToggle",
  error: "ModelsSection_error",
  deleteDialog: "ModelsSection_deleteDialog",
  deleteConfirm: "ModelsSection_deleteConfirm",
  hiddenLabel: "ModelsSection_hiddenLabel",
  switchThumb: "ModelsSection_switchThumb",
  fetchDialog: "ModelsSection_fetchDialog",
  candidateToolbar: "ModelsSection_candidateToolbar",
  candidateSearch: "ModelsSection_candidateSearch",
  candidateList: "ModelsSection_candidateList",
  candidate: "ModelsSection_candidate",
  candidateLabel: "ModelsSection_candidateLabel",
  candidateId: "ModelsSection_candidateId",
  candidateEmpty: "ModelsSection_candidateEmpty"
};

// deepseek-harness/packages/client/ui-settings-models/src/client/ApiKeyInput.tsx
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
var EYE_CONTOUR = "M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z";
var EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`;
var EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`;
function ApiKeyInput({ value, saved, t, ...props }) {
  const [revealedValue, setRevealedValue] = useState();
  const canReveal = saved === void 0 && value.length > 0 && props.disabled !== true;
  const revealed = canReveal && revealedValue === value;
  return /* @__PURE__ */ jsxs4("div", { className: `${ModelsSection_default["keyInput"]} ${saved === void 0 ? "" : ModelsSection_default["savedKeyInput"]}`, children: [
    /* @__PURE__ */ jsx5(
      "input",
      {
        ...props,
        className: `${ModelsSection_default["input"]} ${canReveal ? ModelsSection_default["keyInputFilled"] : ""}`,
        type: revealed ? "text" : "password",
        autoComplete: "new-password",
        value,
        placeholder: saved === void 0 ? props.placeholder : saved.masked,
        onCopy: (event) => {
          if (saved !== void 0) event.preventDefault();
        },
        onCut: (event) => {
          if (saved !== void 0) event.preventDefault();
        },
        onKeyDown: (event) => {
          if (saved !== void 0 && (event.key === "Backspace" || event.key === "Delete")) {
            event.preventDefault();
            saved.clear?.();
          }
        },
        onChange: (event) => {
          setRevealedValue(void 0);
          props.onChange?.(event);
        }
      }
    ),
    !canReveal ? null : /* @__PURE__ */ jsx5(
      "button",
      {
        type: "button",
        className: ModelsSection_default["keyToggle"],
        "aria-label": t(revealed ? "keyHide" : "keyReveal"),
        "aria-pressed": revealed,
        onClick: () => {
          setRevealedValue(revealed ? void 0 : value);
        },
        children: /* @__PURE__ */ jsx5("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", "aria-hidden": "true", children: /* @__PURE__ */ jsx5("path", { d: revealed ? EYE_OFF_PATH : EYE_PATH }) })
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/EditorFooter.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
function EditorFooter(props) {
  const { t } = props;
  return /* @__PURE__ */ jsxs5("div", { className: ModelsSection_default["editorActions"], children: [
    /* @__PURE__ */ jsx6(
      "button",
      {
        type: "button",
        className: ModelsSection_default["secondaryButton"],
        disabled: props.busy,
        onClick: props.onCancel,
        children: t(props.cancelLabelKey ?? "cancel")
      }
    ),
    /* @__PURE__ */ jsx6(
      "button",
      {
        type: "button",
        className: ModelsSection_default["primaryButton"],
        disabled: props.submitDisabled,
        onClick: props.onSubmit,
        children: props.busy ? t(props.submitBusyLabelKey) : t(props.submitLabelKey)
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-primitives/src/AnimatedRows.tsx
import { Component, createRef } from "react";

// deepseek-harness/packages/client/ui-primitives/src/AnimatedRows.module.css
var AnimatedRows_default = {
  exits: "AnimatedRows_exits"
};

// deepseek-harness/packages/client/ui-primitives/src/AnimatedRows.tsx
import { Fragment as Fragment2, jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
var ROW_FADE_MS = 100;
var ROW_GLIDE_MS = 200;
function sameRows(previous, next) {
  return previous.rowKeys.length === next.rowKeys.length && previous.rowKeys.every((key, index) => key === next.rowKeys[index]);
}
function visibleViewport(list) {
  const rect = list.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top),
    bottom: Math.min(window.innerHeight, rect.bottom),
    left: Math.max(0, rect.left),
    right: Math.min(window.innerWidth, rect.right)
  };
}
function intersects(row, viewport) {
  return row.bottom > viewport.top && row.top < viewport.bottom && row.right > viewport.left && row.left < viewport.right;
}
var AnimatedRows = class extends Component {
  armed = false;
  list = createRef();
  overlay = createRef();
  movements = /* @__PURE__ */ new Map();
  exits = /* @__PURE__ */ new Map();
  getSnapshotBeforeUpdate(previous) {
    const list = this.list.current;
    if (!this.armed || sameRows(previous, this.props) || previous.resetKey !== this.props.resetKey || !previous.ready || !this.props.ready || list === null || typeof list.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const viewport = visibleViewport(list);
    const positions = this.readPositions();
    const nextKeys = new Set(this.props.rowKeys);
    const removed = /* @__PURE__ */ new Map();
    for (const [key, row] of positions) {
      if (nextKeys.has(key) || !intersects(row.rect, viewport)) continue;
      const clone2 = row.element.cloneNode(true);
      clone2.removeAttribute("data-row-key");
      clone2.inert = true;
      clone2.style.paddingInlineStart = getComputedStyle(row.element).paddingInlineStart;
      removed.set(key, { ...row, element: clone2 });
    }
    return { viewport, positions, removed };
  }
  componentDidUpdate(previous, _state, snapshot2) {
    if (snapshot2 === null) {
      if (!sameRows(previous, this.props) || previous.resetKey !== this.props.resetKey || previous.ready !== this.props.ready) this.clear();
      return;
    }
    this.cancelMovements();
    const list = this.list.current;
    const overlay = this.overlay.current;
    const viewport = visibleViewport(list);
    const origin = overlay.getBoundingClientRect();
    const positions = this.readPositions();
    for (const [key, row] of positions) {
      this.removeExit(key);
      const previousRow = snapshot2.positions.get(key);
      if (!intersects(row.rect, viewport) && (previousRow === void 0 || !intersects(previousRow.rect, snapshot2.viewport))) continue;
      if (previousRow === void 0) {
        this.move(row.element, [{ opacity: 0 }, { opacity: 1 }], ROW_FADE_MS);
        continue;
      }
      const dx = previousRow.rect.left - row.rect.left;
      const dy = previousRow.rect.top - row.rect.top;
      if (dx === 0 && dy === 0 && previousRow.opacity === 1) continue;
      this.move(row.element, [
        { transform: `translate(${String(dx)}px, ${String(dy)}px)`, opacity: previousRow.opacity },
        { transform: "translate(0, 0)", opacity: 1 }
      ], ROW_GLIDE_MS);
    }
    for (const [key, row] of snapshot2.removed) {
      const { element } = row;
      this.removeExit(key);
      Object.assign(element.style, {
        position: "absolute",
        margin: "0",
        transform: "none",
        boxSizing: "border-box",
        left: `${String(row.rect.left - origin.left)}px`,
        top: `${String(row.rect.top - origin.top)}px`,
        width: `${String(row.rect.width)}px`,
        height: `${String(row.rect.height)}px`
      });
      overlay.append(element);
      const animation = element.animate([{ opacity: row.opacity }, { opacity: 0 }], {
        duration: ROW_FADE_MS,
        easing: "ease-out",
        fill: "forwards"
      });
      this.exits.set(key, { element, animation });
      animation.onfinish = () => {
        this.removeExit(key);
      };
    }
  }
  componentWillUnmount() {
    this.clear();
  }
  readPositions() {
    const list = this.list.current;
    const rows = list.querySelectorAll("[data-row-key]");
    return new Map(Array.from(rows, (element) => [element.dataset.rowKey, {
      element,
      rect: element.getBoundingClientRect(),
      opacity: this.movements.has(element) ? Number(getComputedStyle(element).opacity) : 1
    }]));
  }
  move(element, keyframes, duration) {
    const animation = element.animate(keyframes, { duration, easing: "ease-out" });
    this.movements.set(element, animation);
    animation.onfinish = () => {
      this.movements.delete(element);
      animation.cancel();
    };
  }
  cancelMovements() {
    for (const animation of this.movements.values()) {
      animation.onfinish = null;
      animation.cancel();
    }
    this.movements.clear();
  }
  removeExit(key) {
    const exit = this.exits.get(key);
    if (exit === void 0) return;
    exit.animation.onfinish = null;
    exit.animation.cancel();
    exit.element.remove();
    this.exits.delete(key);
  }
  clear() {
    this.cancelMovements();
    for (const key of this.exits.keys()) this.removeExit(key);
  }
  render() {
    return /* @__PURE__ */ jsxs6(Fragment2, { children: [
      /* @__PURE__ */ jsx7(
        "div",
        {
          ref: this.list,
          className: this.props.className,
          role: this.props.role,
          "aria-label": this.props.label,
          onPointerDownCapture: () => {
            this.armed = true;
          },
          onKeyDownCapture: () => {
            this.armed = true;
          },
          children: this.props.children
        }
      ),
      /* @__PURE__ */ jsx7("div", { ref: this.overlay, className: AnimatedRows_default.exits, "aria-hidden": "true" })
    ] });
  }
};

// deepseek-harness/packages/client/ui-primitives/src/Tooltip.tsx
import { cloneElement, createContext, useCallback, useContext, useEffect as useEffect3, useId, useRef as useRef4, useState as useState2 } from "react";
import { createPortal as createPortal2 } from "react-dom";

// deepseek-harness/packages/client/ui-primitives/src/ShortcutKeys.module.css
var ShortcutKeys_default = {
  keys: "ShortcutKeys_keys",
  key: "ShortcutKeys_key",
  tooltip: "ShortcutKeys_tooltip",
  separator: "ShortcutKeys_separator",
  joined: "ShortcutKeys_joined"
};

// deepseek-harness/packages/client/ui-primitives/src/ShortcutKeys.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
function ShortcutKeys({ keys, variant = "plain", className }) {
  return /* @__PURE__ */ jsx8("span", { className: clsx_default(ShortcutKeys_default.keys, variant === "tooltip" && ShortcutKeys_default.tooltip, variant === "tooltip" && keys.includes("+") && ShortcutKeys_default.joined, className), children: keys.map((key, index) => /* @__PURE__ */ jsx8("kbd", { className: key === "+" ? ShortcutKeys_default.separator : ShortcutKeys_default.key, children: key }, index)) });
}

// deepseek-harness/packages/client/ui-primitives/src/tooltip-placement.ts
var opposite = { right: "left", left: "right", top: "bottom", bottom: "top" };
function placeTooltip(input) {
  const { anchor, viewportWidth, viewportHeight, side, align, gap } = input;
  let { width, height } = input;
  const margin = 12;
  const maxWidth = Math.max(0, viewportWidth - margin * 2);
  const maxHeight = Math.max(0, viewportHeight - margin * 2);
  width = Math.min(width, maxWidth);
  height = Math.min(height, maxHeight);
  const clampX = (x) => Math.max(margin, Math.min(x, viewportWidth - margin - width));
  const clampY = (y) => Math.max(margin, Math.min(y, viewportHeight - margin - height));
  const horizontal = side === "right" || side === "left";
  const candidates = [side, opposite[side], ...horizontal ? ["bottom", "top"] : ["right", "left"]];
  const positions = {
    right: { left: anchor.right + 10, top: clampY((anchor.top + anchor.bottom - height) / 2) },
    left: { left: anchor.left - 10 - width, top: clampY((anchor.top + anchor.bottom - height) / 2) },
    bottom: { left: clampX(align === "end" ? anchor.right - width : (anchor.left + anchor.right - width) / 2), top: anchor.bottom + gap },
    top: { left: clampX(align === "end" ? anchor.right - width : (anchor.left + anchor.right - width) / 2), top: anchor.top - gap - height }
  };
  for (const candidate of candidates) {
    const position2 = positions[candidate];
    if (position2.left >= margin && position2.top >= margin && position2.left + width <= viewportWidth - margin && position2.top + height <= viewportHeight - margin) {
      return { ...position2, side: candidate, width, height, overflow: false };
    }
  }
  const position = positions[side];
  return { left: clampX(position.left), top: clampY(position.top), side, width, height, overflow: true };
}

// deepseek-harness/packages/client/ui-primitives/src/useDismissOnOutsidePointer.ts
import { useEffect as useEffect2 } from "react";
function useDismissOnOutsidePointer(root, open, setOpen, portal) {
  useEffect2(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true && portal?.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [root, open, setOpen, portal]);
}

// deepseek-harness/packages/client/ui-primitives/src/Tooltip.module.css
var Tooltip_default = {
  bubble: "Tooltip_bubble",
  "tooltip-in": "Tooltip_tooltip-in",
  label: "Tooltip_label"
};

// deepseek-harness/packages/client/ui-primitives/src/input-modality.ts
var INPUT_MODALITY = { pointer: "pointer", keyboard: "keyboard" };
var INPUT_MODALITY_ATTRIBUTE = "data-input-modality";
var FOCUS_NAVIGATION = /* @__PURE__ */ new Set(["Tab", "Home", "End", "PageUp", "PageDown"]);
var pointer = false;
var pointerOwnsFocus = false;
var keyFocusOrigin;
function publish() {
  document.documentElement.setAttribute(INPUT_MODALITY_ATTRIBUTE, pointerOwnsFocus ? INPUT_MODALITY.pointer : INPUT_MODALITY.keyboard);
}
function pointerModality() {
  return pointer;
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => {
    pointer = true;
    pointerOwnsFocus = true;
    keyFocusOrigin = void 0;
    publish();
  }, true);
  window.addEventListener("keydown", (event) => {
    pointer = false;
    if (event.isComposing) {
      keyFocusOrigin = void 0;
      return;
    }
    keyFocusOrigin = event.composedPath()[0];
    if (!FOCUS_NAVIGATION.has(event.key) && !event.key.startsWith("Arrow")) return;
    pointerOwnsFocus = false;
    publish();
  }, true);
  window.addEventListener("focusin", (event) => {
    if (keyFocusOrigin === void 0 || event.composedPath()[0] === keyFocusOrigin) return;
    keyFocusOrigin = void 0;
    if (!pointerOwnsFocus) return;
    pointerOwnsFocus = false;
    publish();
  }, true);
  window.addEventListener("blur", () => {
    keyFocusOrigin = void 0;
  });
}

// deepseek-harness/packages/client/ui-primitives/src/Tooltip.tsx
import { jsx as jsx9, jsxs as jsxs7 } from "react/jsx-runtime";
var TooltipSuppression = createContext(null);
function clipped(anchor) {
  return [anchor, ...anchor.querySelectorAll("*")].some((el) => el instanceof HTMLElement && el.scrollWidth > el.clientWidth);
}
function Tooltip({ label, shortcutKeys, side = "right", align = "center", delayMs = 0, focusDelayMs = 0, gap = 8, disabled = false, portal = false, maxWidth, openOnClick = false, onlyWhenClipped = false, children }) {
  const id = useId();
  const [pinned, setPinned] = useState2(false);
  const anchor = useRef4(null);
  const childRef = children.ref;
  const mergedRef = useCallback((el) => {
    anchor.current = el;
    if (typeof childRef === "function") childRef(el);
    else if (childRef != null) childRef.current = el;
  }, [childRef]);
  const [pos, setPos] = useState2(null);
  const bubble = useRef4(null);
  const resolvedLabel = pos === null ? null : typeof label === "function" ? label() : label;
  const showTimer = useRef4(null);
  const triggers = useRef4({ hover: false, focus: false });
  const suppressAncestors = useContext(TooltipSuppression);
  const [suppressed, setSuppressed] = useState2(false);
  const announce = useCallback((active) => {
    suppressAncestors?.(active);
  }, [suppressAncestors]);
  const visible = pos !== null && !disabled;
  useEffect3(() => {
    const el = bubble.current;
    if (pos === null || !visible || suppressed || el === null) return;
    let size;
    let anchorRect = pos;
    const fit = () => {
      if (size === void 0) return;
      const placement = placeTooltip({
        anchor: anchorRect,
        width: size.inlineSize,
        height: size.blockSize,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        side,
        align,
        gap
      });
      const horizontal = placement.side === "right" || placement.side === "left";
      const offsetX = horizontal ? 0 : align === "end" ? placement.width : placement.width / 2;
      const offsetY = horizontal ? placement.height / 2 : placement.side === "top" ? placement.height : 0;
      el.style.left = `${placement.left + offsetX}px`;
      el.style.top = `${placement.top + offsetY}px`;
      el.dataset.side = placement.side;
      el.style.visibility = "visible";
    };
    const onResize = () => {
      if (anchor.current !== null) anchorRect = anchor.current.getBoundingClientRect();
      fit();
    };
    const observer = new ResizeObserver((entries) => {
      size = entries[0]?.borderBoxSize[0];
      fit();
    });
    observer.observe(el, { box: "border-box" });
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [align, gap, pos, side, suppressed, visible]);
  useEffect3(() => {
    announce(visible);
    return () => {
      announce(false);
    };
  }, [announce, visible]);
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return;
    clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);
  useEffect3(() => {
    if (pinned && (disabled || !openOnClick)) setPinned(false);
    if (disabled) {
      cancelShow();
      triggers.current = { hover: false, focus: false };
      setPos(null);
    }
    return cancelShow;
  }, [cancelShow, disabled, openOnClick, pinned]);
  const show = () => {
    if (disabled) return;
    const el = anchor.current;
    if (el === null) return;
    if (onlyWhenClipped && !clipped(el)) return;
    setPos(el.getBoundingClientRect());
    announce(true);
  };
  const showAfterDelay = (delay) => {
    cancelShow();
    if (delay <= 0) {
      show();
      return;
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      show();
    }, delay);
  };
  const withdraw = useCallback(() => {
    setPinned(false);
    setPos(null);
    announce(false);
  }, [announce]);
  const hide = () => {
    cancelShow();
    if (!triggers.current.hover && !triggers.current.focus && !pinned) withdraw();
  };
  const dismiss = useCallback(() => {
    cancelShow();
    triggers.current = { hover: false, focus: false };
    withdraw();
  }, [cancelShow, withdraw]);
  useDismissOnOutsidePointer(anchor, openOnClick && visible, dismiss, bubble);
  useEffect3(() => {
    if (!openOnClick || !visible) return;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [dismiss, openOnClick, visible]);
  const content = visible && !suppressed && /* @__PURE__ */ jsxs7(
    "span",
    {
      ref: bubble,
      id: openOnClick ? id : void 0,
      className: Tooltip_default.bubble,
      "data-side": side,
      "data-portal": portal || void 0,
      "data-pinned": pinned || void 0,
      "data-align": align,
      "data-has-shortcut": shortcutKeys?.length ? true : void 0,
      style: { left: pos.left, top: pos.top, visibility: "hidden", ...maxWidth === void 0 ? {} : { maxWidth: `min(${maxWidth}px, calc(100vw - 24px))` } },
      role: "tooltip",
      "aria-label": shortcutKeys?.length ? [resolvedLabel, shortcutKeys.join(" ")].filter(Boolean).join(" ") : void 0,
      children: [
        resolvedLabel && /* @__PURE__ */ jsx9("span", { className: Tooltip_default.label, children: resolvedLabel }),
        shortcutKeys !== void 0 && shortcutKeys.length > 0 && /* @__PURE__ */ jsx9(ShortcutKeys, { keys: shortcutKeys, variant: "tooltip" })
      ]
    }
  );
  return /* @__PURE__ */ jsxs7(TooltipSuppression.Provider, { value: setSuppressed, children: [
    cloneElement(children, {
      ref: mergedRef,
      "aria-describedby": openOnClick && visible ? [children.props["aria-describedby"], id].filter(Boolean).join(" ") : children.props["aria-describedby"],
      onPointerEnter: (e) => {
        children.props.onPointerEnter?.(e);
        if (e.pointerType === "touch") return;
        if (e.pointerType === "mouse" && !window.matchMedia("(any-hover: hover)").matches) return;
        triggers.current.hover = true;
        showAfterDelay(delayMs);
      },
      onPointerLeave: (e) => {
        children.props.onPointerLeave?.(e);
        triggers.current.hover = false;
        cancelShow();
        if (!pinned) withdraw();
      },
      onPointerDown: (e) => {
        children.props.onPointerDown?.(e);
        if (e.pointerType === "touch" && !pinned) dismiss();
      },
      // Activating an ordinary action dismisses the bubble: it often changes
      // what the anchor now does (pin → unpin), and the click leaves the
      // anchor focused, which would otherwise pin the relabelled bubble up.
      onClick: (e) => {
        children.props.onClick?.(e);
        triggers.current.focus = false;
        cancelShow();
        if (openOnClick && !disabled && !pinned) {
          setPinned(true);
          show();
        } else withdraw();
      },
      onFocus: (e) => {
        children.props.onFocus?.(e);
        if (pointerModality()) return;
        triggers.current.focus = true;
        showAfterDelay(focusDelayMs);
      },
      onBlur: (e) => {
        children.props.onBlur?.(e);
        triggers.current.focus = false;
        hide();
      }
    }),
    portal ? content !== false && createPortal2(content, document.body) : content
  ] });
}

// deepseek-harness/packages/client/ui-primitives/src/useRowDragPreview.ts
import { useEffect as useEffect4, useMemo, useRef as useRef5 } from "react";

// deepseek-harness/packages/client/ui-primitives/src/RowDragPreview.module.css
var RowDragPreview_default = {
  preview: "RowDragPreview_preview"
};

// deepseek-harness/packages/client/ui-primitives/src/useRowDragPreview.ts
function useRowDragPreview(className, inheritedProperties) {
  const current2 = useRef5(null);
  const dragging = useRef5(false);
  const preview = useMemo(() => {
    const clear = () => {
      const wasDragging = dragging.current;
      dragging.current = false;
      current2.current?.remove();
      current2.current = null;
      return wasDragging;
    };
    return {
      clear,
      start: (event, row = event.currentTarget) => {
        clear();
        dragging.current = true;
        const rect = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const copy = row.cloneNode(true);
        copy.removeAttribute("data-row-key");
        copy.tabIndex = -1;
        for (const control of copy.querySelectorAll(
          "button, a[href], input, select, textarea, [tabindex], [contenteditable]"
        )) control.tabIndex = -1;
        copy.style.color = style.color;
        copy.style.paddingInlineStart = style.paddingInlineStart;
        const image = row.ownerDocument.createElement("div");
        image.className = clsx_default(RowDragPreview_default.preview, className);
        image.inert = true;
        image.setAttribute("aria-hidden", "true");
        inheritedProperties?.forEach((property2) => {
          image.style.setProperty(property2, style.getPropertyValue(property2));
        });
        Object.assign(image.style, {
          left: `${String(-rect.width)}px`,
          width: `${String(rect.width)}px`,
          height: `${String(rect.height)}px`,
          font: style.font
        });
        image.append(copy);
        row.ownerDocument.body.append(image);
        current2.current = image;
        try {
          event.dataTransfer.setDragImage(image, event.clientX - rect.left, event.clientY - rect.top);
        } catch (_error) {
          image.remove();
          current2.current = null;
        }
      }
    };
  }, [className, inheritedProperties]);
  useEffect4(() => () => {
    preview.clear();
  }, [preview]);
  return preview;
}

// deepseek-harness/packages/client/ui-primitives/src/Checkbox.module.css
var Checkbox_default = {
  checkbox: "Checkbox_checkbox"
};

// deepseek-harness/packages/client/ui-primitives/src/Checkbox.tsx
import { jsx as jsx10, jsxs as jsxs8 } from "react/jsx-runtime";
function Checkbox({ checked, onChange, label, disabled = false, title, className, modalAutofocus = false }) {
  return /* @__PURE__ */ jsxs8("label", { className: clsx_default(Checkbox_default.checkbox, className), title, children: [
    /* @__PURE__ */ jsx10(
      "input",
      {
        type: "checkbox",
        checked,
        disabled,
        "data-modal-autofocus": modalAutofocus || void 0,
        onChange: (event) => {
          onChange(event.target.checked);
        }
      }
    ),
    /* @__PURE__ */ jsx10("span", { children: label })
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelInputTypes.tsx
import { jsx as jsx11, jsxs as jsxs9 } from "react/jsx-runtime";
function ModelInputTypes({ model, field, position, disabled, fallback, t, onChange }) {
  const modalities = model[field];
  const selected = Array.isArray(modalities) && modalities.length > 0 ? modalities : fallback ?? ["text"];
  return /* @__PURE__ */ jsxs9("fieldset", { className: ModelsSection_default["modelInputTypes"], "aria-label": `${t("modelInputTypes")} ${String(position)}`, children: [
    /* @__PURE__ */ jsx11("legend", { className: ModelsSection_default["modelFieldLabel"], children: t("modelInputTypes") }),
    /* @__PURE__ */ jsx11("div", { className: ModelsSection_default["modelInputChoices"], children: ["text", "image"].map((modality) => /* @__PURE__ */ jsx11(
      Checkbox,
      {
        label: t(modality === "text" ? "modelInputText" : "modelInputImage"),
        checked: selected.includes(modality),
        disabled: disabled || selected.length === 1 && selected.includes(modality),
        onChange: (checked) => {
          const nextSelected = ["text", "image"].filter((value) => value === modality ? checked : selected.includes(value));
          const next = { ...model, [field]: nextSelected };
          if (field === "inputModalities" && !nextSelected.includes("image")) {
            Reflect.deleteProperty(next, "imagePixelBudget");
            Reflect.deleteProperty(next, "imageMaxBytes");
          }
          onChange(next);
        }
      },
      modality
    )) })
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx
import { useState as useState3 } from "react";

// deepseek-harness/packages/client/ui-primitives/src/Switch.module.css
var Switch_default = {
  switch: "Switch_switch2",
  thumb: "Switch_thumb2"
};

// deepseek-harness/packages/client/ui-primitives/src/Switch.tsx
import { jsx as jsx12 } from "react/jsx-runtime";
function Switch({ checked, onChange, label, disabled = false, title, className, autoFocus, describedBy }) {
  return /* @__PURE__ */ jsx12(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      "aria-describedby": describedBy,
      title,
      disabled,
      autoFocus,
      className: clsx_default(Switch_default.switch, className),
      onClick: () => {
        onChange(!checked);
      },
      children: /* @__PURE__ */ jsx12("span", { className: Switch_default.thumb })
    }
  );
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx
import { Fragment as Fragment3, jsx as jsx13, jsxs as jsxs10 } from "react/jsx-runtime";
var INITIAL_LEVELS = ["off", "low", "medium", "high"];
function defaultValue(level) {
  return level === "off" ? null : level;
}
function acceptedValue(level, wire) {
  return typeof wire === "string" ? wire.length > 0 : wire === null && level === "off";
}
function readEfforts(model) {
  const value = model["reasoningEfforts"];
  if (value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) return void 0;
  return Object.entries(value);
}
function withEfforts(model, entries) {
  const next = { ...model };
  if (entries === void 0) {
    Reflect.deleteProperty(next, "reasoningEfforts");
    return next;
  }
  next["reasoningEfforts"] = Object.fromEntries(entries);
  return next;
}
function outsideLevels(only, level, wire) {
  return !only.includes(level) || wire !== level;
}
function validateReasoningEfforts(value, only) {
  for (const [index, model] of modelDrafts(value).entries()) {
    const entries = readEfforts(model);
    if (entries === void 0) continue;
    if (only !== void 0 && entries.some(([level, wire]) => outsideLevels(only, level, wire))) {
      return { index, key: "modelReasoningLevelsOnly" };
    }
    if (entries.some(([level, wire]) => !acceptedValue(level, wire))) return { index, key: "modelReasoningValueRequired" };
    if (!entries.some(([level]) => level !== "off")) return { index, key: "modelReasoningNeedsLevel" };
  }
  return void 0;
}
function ModelReasoningEfforts(props) {
  const { model, levels, levelsOnly, position, disabled, t, onChange } = props;
  const entries = readEfforts(model);
  const [typing, setTyping] = useState3(void 0);
  const label = `${t("modelReasoning")} ${String(position)}`;
  const used = entries?.map(([level]) => level) ?? [];
  const write2 = (next) => {
    onChange(withEfforts(model, next));
  };
  const replaceAt = (current2, index, entry) => current2.map((existing, at) => at === index ? entry : existing);
  const changeLevel = (current2, index, from2, wire, to) => {
    const carried = !levelsOnly && typeof wire === "string" && wire.length > 0 && wire !== from2 && from2 !== "off" && to !== "off";
    write2(replaceAt(current2, index, [to, carried ? wire : defaultValue(to)]));
  };
  const addLevel = (current2) => {
    const highest = Math.max(-1, ...used.map((level2) => levels.indexOf(level2)));
    const level = levels.find((candidate, index) => index > highest && !used.includes(candidate)) ?? levels.find((candidate) => !used.includes(candidate));
    if (level === void 0) return;
    write2([...current2, [level, defaultValue(level)]]);
  };
  const editValue = (current2, index, level, text) => {
    setTyping({ level, text });
    const trimmed = text.trim();
    write2(replaceAt(current2, index, [level, trimmed.length === 0 ? defaultValue(level) : trimmed]));
  };
  const leaveValue = (current2, index, level, wire) => {
    setTyping(void 0);
    if (!acceptedValue(level, wire)) write2(replaceAt(current2, index, [level, defaultValue(level)]));
  };
  const choicesFor = (level) => [
    ...levels.includes(level) ? [] : [level],
    ...levels.filter((choice) => choice === level || !used.includes(choice))
  ];
  const initialEntries = INITIAL_LEVELS.filter((level) => levels.includes(level)).map((level) => [level, defaultValue(level)]);
  const refused = entries?.some(([level, wire]) => !acceptedValue(level, wire)) === true;
  const missingLevel = entries !== void 0 && !used.some((level) => level !== "off");
  const outside = levelsOnly && entries?.some(([level, wire]) => outsideLevels(levels, level, wire)) === true;
  return /* @__PURE__ */ jsxs10("div", { className: ModelsSection_default["modelReasoning"], role: "group", "aria-label": label, children: [
    /* @__PURE__ */ jsxs10("div", { className: ModelsSection_default["modelReasoningHead"], children: [
      /* @__PURE__ */ jsxs10("span", { className: `${ModelsSection_default["modelFieldLabel"]} ${ModelsSection_default["modelReasoningLabel"]}`, children: [
        t("modelReasoning"),
        /* @__PURE__ */ jsx13(Tooltip, { label: t("modelReasoningHelpText"), side: "right", delayMs: 0, focusDelayMs: 0, portal: true, openOnClick: true, children: /* @__PURE__ */ jsx13("button", { type: "button", className: ModelsSection_default["helpButton"], "aria-label": t("modelReasoningHelp"), children: "?" }) })
      ] }),
      /* @__PURE__ */ jsx13(
        Switch,
        {
          checked: entries !== void 0,
          label,
          disabled,
          onChange: (on) => {
            write2(on ? initialEntries : void 0);
          }
        }
      )
    ] }),
    entries === void 0 ? null : /* @__PURE__ */ jsxs10(Fragment3, { children: [
      entries.length > 0 ? /* @__PURE__ */ jsxs10("div", { className: ModelsSection_default["modelReasoningRow"], "aria-hidden": "true", children: [
        /* @__PURE__ */ jsx13("span", { className: ModelsSection_default["modelFieldLabel"], children: t("modelReasoningLevel") }),
        /* @__PURE__ */ jsx13("span", { className: ModelsSection_default["modelFieldLabel"], children: t("modelReasoningValue") })
      ] }) : null,
      entries.map(([level, wire], index) => (
        // A row is the entry at this position of the stored dict: changing its
        // level edits that entry in place and rows keep no state of their own,
        // so the position is the row's identity. Keying by level would remount
        // the select on every change and drop keyboard focus.
        /* @__PURE__ */ jsxs10("div", { className: ModelsSection_default["modelReasoningRow"], children: [
          /* @__PURE__ */ jsx13(
            "select",
            {
              className: `${ModelsSection_default["input"]} ${ModelsSection_default["selectInput"]}`,
              value: level,
              "aria-label": `${t("modelReasoningLevel")} ${String(index + 1)}`,
              disabled,
              onChange: (event) => {
                changeLevel(entries, index, level, wire, event.target.value);
              },
              children: choicesFor(level).map((choice) => /* @__PURE__ */ jsx13("option", { value: choice, children: choice }, choice))
            }
          ),
          /* @__PURE__ */ jsx13(
            "input",
            {
              className: `${ModelsSection_default["input"]} ${ModelsSection_default["modelReasoningValueInput"]}`,
              type: "text",
              value: typing?.level === level ? typing.text : typeof wire === "string" ? wire : "",
              placeholder: level === "off" ? t("modelReasoningOffValuePlaceholder") : level,
              "aria-label": `${level} ${t("modelReasoningValue")}`,
              "aria-invalid": !acceptedValue(level, wire),
              disabled: disabled || level === "off" || levelsOnly,
              onChange: (event) => {
                editValue(entries, index, level, event.target.value);
              },
              onBlur: () => {
                leaveValue(entries, index, level, wire);
              }
            }
          ),
          /* @__PURE__ */ jsx13(
            "button",
            {
              type: "button",
              className: `${ModelsSection_default["iconButton"]} ${ModelsSection_default["iconButtonDanger"]}`,
              "aria-label": `${t("modelReasoningRemove")} ${level}`,
              title: t("modelReasoningRemove"),
              disabled,
              onClick: () => {
                write2(entries.filter((_entry, at) => at !== index));
              },
              children: /* @__PURE__ */ jsx13(IconTrashOutlineRegular, { size: 14 })
            }
          )
        ] }, index)
      )),
      outside ? /* @__PURE__ */ jsx13("p", { className: ModelsSection_default["error"], children: t("modelReasoningLevelsOnly") }) : refused ? /* @__PURE__ */ jsx13("p", { className: ModelsSection_default["error"], children: t("modelReasoningValueRequired") }) : missingLevel ? /* @__PURE__ */ jsx13("p", { className: ModelsSection_default["error"], children: t("modelReasoningNeedsLevel") }) : null,
      /* @__PURE__ */ jsxs10(
        "button",
        {
          type: "button",
          className: ModelsSection_default["addModelButton"],
          disabled: disabled || levels.every((level) => used.includes(level)),
          onClick: () => {
            addLevel(entries);
          },
          children: [
            /* @__PURE__ */ jsx13(IconPlusOutlineRegular, { size: 14 }),
            t("modelReasoningAdd")
          ]
        }
      )
    ] })
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelRow.tsx
import { jsx as jsx14, jsxs as jsxs11 } from "react/jsx-runtime";
function rowHalf(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
function ModelRow(props) {
  const { model, position, t, disabled } = props;
  const preview = useRowDragPreview(ModelsSection_default["modelDragPreview"]);
  const modelField = (field) => /* @__PURE__ */ jsxs11("label", { className: `${ModelsSection_default["modelField"]} ${field === "name" ? ModelsSection_default["modelName"] : ""}`, children: [
    field === "name" ? /* @__PURE__ */ jsx14("span", { className: `${ModelsSection_default["modelFieldLabel"]} ${ModelsSection_default["modelNameLabel"]}`, children: t("modelName") }) : null,
    /* @__PURE__ */ jsx14(
      "input",
      {
        className: ModelsSection_default["input"],
        type: "text",
        value: typeof model[field] === "string" ? model[field] : "",
        placeholder: t(field === "id" ? "modelId" : "modelName"),
        "aria-label": `${t(field === "id" ? "modelId" : "modelName")} ${String(position)}`,
        disabled,
        onFocus: field === "name" && !props.expanded ? props.onToggle : void 0,
        onChange: (event) => {
          const value = event.target.value;
          props.onFieldChange(field, field === "name" && value === "" ? void 0 : value);
        },
        onBlur: field === "id" ? (event) => props.onIdBlur?.(event.target.value) : void 0
      }
    )
  ] });
  return /* @__PURE__ */ jsx14(
    "div",
    {
      className: ModelsSection_default["modelEntry"],
      "data-row-key": props.rowKey,
      "data-dragging": props.order.dragging || void 0,
      "data-drop-target": props.order.dragging ? void 0 : props.order.target,
      onDragOver: (event) => {
        if (!props.order.canDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        props.order.onOver(rowHalf(event));
      },
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        props.order.onLeave();
      },
      onDrop: (event) => {
        if (!props.order.canDrop) return;
        event.preventDefault();
        props.order.onDrop(rowHalf(event));
      },
      children: /* @__PURE__ */ jsxs11("div", { className: ModelsSection_default["modelRow"], "data-expanded": props.expanded || void 0, children: [
        /* @__PURE__ */ jsx14(Tooltip, { label: t("reorderModelHelp"), portal: true, children: /* @__PURE__ */ jsx14(
          "button",
          {
            type: "button",
            className: `${ModelsSection_default["iconButton"]} ${ModelsSection_default["modelDragHandle"]}`,
            "aria-label": `${t("reorderModel")} ${String(position)}`,
            "aria-keyshortcuts": "ArrowUp ArrowDown",
            "aria-description": t("reorderModelHelp"),
            disabled,
            draggable: !disabled,
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-dsh-model-order", String(position));
              props.order.onStart();
              preview.start(event, event.currentTarget.closest("[data-row-key]"));
            },
            onDragEnd: () => {
              if (preview.clear()) props.order.onEnd();
            },
            onKeyDown: (event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              event.stopPropagation();
              props.order.onMove(event.key === "ArrowUp" ? -1 : 1);
            },
            children: /* @__PURE__ */ jsx14(IconDragHandleOutlineRegular, { size: 14 })
          }
        ) }),
        modelField("id"),
        /* @__PURE__ */ jsx14(
          "button",
          {
            type: "button",
            className: ModelsSection_default["iconButton"],
            "aria-label": `${t("modelAdvanced")} ${String(position)}`,
            "aria-expanded": props.expanded,
            title: t("modelAdvanced"),
            onClick: (event) => {
              event.currentTarget.focus();
              props.onToggle();
            },
            children: props.expanded ? /* @__PURE__ */ jsx14(IconChevronDownOutlineRegular, {}) : /* @__PURE__ */ jsx14(IconChevronRightOutlineRegular, {})
          }
        ),
        /* @__PURE__ */ jsx14(
          "button",
          {
            type: "button",
            className: `${ModelsSection_default["iconButton"]} ${ModelsSection_default["iconButtonDanger"]}`,
            "aria-label": `${t("removeModel")} ${String(position)}`,
            title: t("removeModel"),
            disabled,
            onClick: props.onRemove,
            children: /* @__PURE__ */ jsx14(IconTrashOutlineRegular, { size: 14 })
          }
        ),
        modelField("name"),
        props.expanded ? /* @__PURE__ */ jsxs11("div", { className: ModelsSection_default["modelAdvanced"], children: [
          ["contextWindow", "maxTokens"].map((field) => /* @__PURE__ */ jsxs11("label", { className: ModelsSection_default["modelField"], children: [
            /* @__PURE__ */ jsx14("span", { className: ModelsSection_default["modelFieldLabel"], children: t(field) }),
            /* @__PURE__ */ jsx14(
              "input",
              {
                className: ModelsSection_default["input"],
                type: "text",
                inputMode: "numeric",
                value: props[field].value,
                placeholder: props[field].placeholder,
                "aria-label": `${t(field)} ${String(position)}`,
                disabled,
                onChange: (event) => {
                  props[field].onChange(event.target.value);
                },
                onBlur: props[field].onBlur
              }
            )
          ] }, field)),
          /* @__PURE__ */ jsx14(
            ModelInputTypes,
            {
              model,
              field: props.inputField,
              position,
              fallback: props.inputFallback,
              disabled: disabled || props.inputLoading === true,
              t,
              onChange: props.onChange
            }
          ),
          props.reasoningLevels !== void 0 && props.reasoningLevels.length > 0 ? /* @__PURE__ */ jsx14(
            ModelReasoningEfforts,
            {
              model,
              levels: props.reasoningLevels,
              levelsOnly: props.reasoningLevelsOnly === true,
              position,
              disabled,
              t,
              onChange: props.onChange
            }
          ) : null
        ] }) : null
      ] })
    }
  );
}

// deepseek-harness/packages/client/ui-settings-models/src/client/useModelRows.ts
import { useRef as useRef6, useState as useState4 } from "react";
function createRow(key) {
  return { key, expanded: false, editing: /* @__PURE__ */ new Map() };
}
function useModelRows(models, onChange, disabled) {
  const nextKey = useRef6(0);
  const [stored, setRows] = useState4(() => models.map(() => createRow(nextKey.current++)));
  const [dragged, setDragged] = useState4();
  const [target, setTarget] = useState4();
  const entries = models.map((model, index) => ({ model, state: stored[index] ?? createRow(nextKey.current++) }));
  const rows = entries.map((entry) => entry.state);
  if (stored.length !== models.length) setRows(rows);
  const endDrag = () => {
    setDragged(void 0);
    setTarget(void 0);
  };
  const move = (from2, to) => {
    if (disabled || from2 === to || from2 < 0 || to < 0 || to >= models.length) return;
    const order = [...entries];
    const moved = order.splice(from2, 1);
    order.splice(to, 0, ...moved);
    setRows(order.map((entry) => entry.state));
    onChange(order.map((entry) => entry.model));
  };
  return {
    rows: entries.map(({ model, state }, index) => ({
      ...state,
      model,
      order: {
        dragging: dragged === state.key,
        target: target?.key === state.key ? target.half : void 0,
        canDrop: !disabled && dragged !== void 0,
        onStart: () => {
          setDragged(state.key);
        },
        onEnd: endDrag,
        onOver: (half) => {
          setTarget((current2) => current2?.key === state.key && current2.half === half ? current2 : { key: state.key, half });
        },
        onLeave: () => {
          setTarget((current2) => current2?.key === state.key ? void 0 : current2);
        },
        onDrop: (half) => {
          const from2 = rows.findIndex((row) => row.key === dragged);
          const insertion = index + (half === "after" ? 1 : 0);
          move(from2, insertion > from2 ? insertion - 1 : insertion);
          endDrag();
        },
        onMove: (offset) => {
          move(index, index + offset);
        }
      }
    })),
    toggle: (index) => {
      setRows(rows.map((row, at) => at === index ? { ...row, expanded: !row.expanded } : row));
    },
    edit: (index, field, text) => {
      setRows(rows.map((row, at) => {
        if (at !== index) return row;
        const editing = new Map(row.editing);
        if (text === void 0) editing.delete(field);
        else editing.set(field, text);
        return { ...row, editing };
      }));
    },
    forget: (removed) => {
      setRows(rows.filter((_row, index) => !removed.has(index)));
      endDrag();
    },
    reset: () => {
      setRows(models.map(() => createRow(nextKey.current++)));
      endDrag();
    }
  };
}

// deepseek-harness/packages/client/ui-settings-models/src/client/DeepSeekModelsEditor.tsx
import { jsx as jsx15, jsxs as jsxs12 } from "react/jsx-runtime";
var CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
var CAPACITY_SCALE = { k: 1e3, m: 1e6 };
function parseCapacity(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return void 0;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
function formatCapacity(value) {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}
function modelDrafts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {});
}
function validateDeepSeekModels(value) {
  if (value === void 0) return void 0;
  const models = modelDrafts(value);
  const seen = /* @__PURE__ */ new Set();
  for (const [index, model] of models.entries()) {
    const id = model["id"];
    const trimmed = typeof id === "string" ? id.trim() : void 0;
    if (trimmed === void 0 || trimmed.length === 0) return { index, key: "modelIdRequired" };
    if (seen.has(trimmed)) return { index, key: "modelIdDuplicate" };
    seen.add(trimmed);
    const name = model["name"];
    if (name !== void 0 && (typeof name !== "string" || name.length === 0)) {
      return { index, key: "modelNameInvalid" };
    }
    const contextWindow = model["contextWindow"];
    if (contextWindow !== void 0 && (typeof contextWindow !== "number" || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: "modelContextInvalid" };
    }
    const maxTokens = model["maxTokens"];
    if (maxTokens !== void 0 && (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: "modelMaxTokensInvalid" };
    }
  }
  return void 0;
}
function DeepSeekModelsEditor(props) {
  const rowState = useModelRows(props.models, props.onChange, props.disabled);
  const update = (index, key, value) => {
    const next = props.models.map((model, at) => {
      const copy = { ...model };
      if (at !== index) return copy;
      if (value === void 0) Reflect.deleteProperty(copy, key);
      else copy[key] = value;
      return copy;
    });
    props.onChange(next);
  };
  const remove = (index) => {
    rowState.forget(/* @__PURE__ */ new Set([index]));
    props.onChange(props.models.filter((_model, at) => at !== index).map((model) => ({ ...model })));
  };
  const reset = () => {
    rowState.reset();
    props.onReset();
  };
  const capacityText = (model, index, field) => {
    const typed = rowState.rows[index]?.editing.get(field);
    if (typed !== void 0) return typed;
    const value = model[field];
    return typeof value === "number" ? formatCapacity(value) : "";
  };
  const settleCapacity = (index, field) => {
    const typed = rowState.rows[index]?.editing.get(field);
    if (typed === void 0) return;
    const parsed = parseCapacity(typed);
    if (parsed !== void 0 && Number.isNaN(parsed)) return;
    rowState.edit(index, field, void 0);
  };
  const capacityInput = (model, index, field, fallback) => ({
    value: capacityText(model, index, field),
    placeholder: fallback === void 0 ? props.t(field === "contextWindow" ? "contextWindowPlaceholder" : "maxTokensPlaceholder") : formatCapacity(fallback),
    onChange: (text) => {
      rowState.edit(index, field, text);
      update(index, field, parseCapacity(text));
    },
    onBlur: () => {
      settleCapacity(index, field);
    }
  });
  return /* @__PURE__ */ jsxs12("section", { className: ModelsSection_default["modelCatalog"], "aria-label": props.t("models"), children: [
    /* @__PURE__ */ jsxs12("div", { className: ModelsSection_default["modelListHead"], children: [
      /* @__PURE__ */ jsxs12("div", { className: ModelsSection_default["modelCatalogHeading"], children: [
        /* @__PURE__ */ jsx15("span", { className: ModelsSection_default["modelCatalogTitle"], children: props.t("models") }),
        /* @__PURE__ */ jsx15("span", { className: ModelsSection_default["modelCatalogMeta"], children: props.overridden ? props.t("modelsCustomized") : props.t("modelsInherited") })
      ] }),
      props.overridden ? /* @__PURE__ */ jsx15(
        "button",
        {
          type: "button",
          className: ModelsSection_default["linkButton"],
          disabled: props.disabled,
          onClick: reset,
          children: props.t("resetModels")
        }
      ) : null
    ] }),
    /* @__PURE__ */ jsxs12(AnimatedRows, { className: ModelsSection_default["modelList"], rowKeys: rowState.rows.map((row) => String(row.key)), ready: true, resetKey: "", children: [
      props.models.length === 0 ? /* @__PURE__ */ jsx15("p", { className: ModelsSection_default["modelEmpty"], children: props.t("modelsEmpty") }) : null,
      rowState.rows.map(({ model, key, expanded, order }, index) => /* @__PURE__ */ jsx15(
        ModelRow,
        {
          rowKey: key,
          order,
          model,
          position: index + 1,
          inputField: "inputModalities",
          expanded,
          disabled: props.disabled,
          t: props.t,
          contextWindow: capacityInput(model, index, "contextWindow", props.defaultContextWindow),
          maxTokens: capacityInput(model, index, "maxTokens", props.defaultMaxTokens),
          onFieldChange: (field, value) => {
            update(index, field, value);
          },
          onIdBlur: (value) => {
            const trimmed = value.trim();
            if (trimmed !== value) update(index, "id", trimmed);
          },
          onChange: (next) => {
            props.onChange(props.models.map((row, at) => at === index ? next : row));
          },
          onToggle: () => {
            rowState.toggle(index);
          },
          onRemove: () => {
            remove(index);
          }
        },
        key
      ))
    ] }),
    /* @__PURE__ */ jsxs12(
      "button",
      {
        type: "button",
        className: ModelsSection_default["addModelButton"],
        disabled: props.disabled,
        onClick: () => {
          props.onChange([...props.models.map((model) => ({ ...model })), { id: "" }]);
        },
        children: [
          /* @__PURE__ */ jsx15(IconPlusOutlineRegular, { size: 14 }),
          props.t("addModel")
        ]
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelListEditor.tsx
import { useEffect as useEffect5, useMemo as useMemo2, useState as useState5 } from "react";

// deepseek-harness/packages/util/text-search/src/index.ts
var import_fuzzysort = __toESM(require_fuzzysort());
var FUZZY_PREFIX = 4;
var FUZZY_SUBSTRING = 3;
var FUZZY_SUBSEQUENCE = 2;
var SUBSTRING = 1;
var WORD_CHAR = /[\p{L}\p{N}]/u;
var UPPER = new RegExp("\\p{Lu}", "u");
var LOWER = new RegExp("\\p{Ll}", "u");
var UNSPACED = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]/u;
function codePointAt(text, index) {
  return String.fromCodePoint(text.codePointAt(index));
}
function codePointBefore(text, index) {
  const low = text.charCodeAt(index - 1);
  const start = low >= 56320 && low <= 57343 && index >= 2 ? index - 2 : index - 1;
  return codePointAt(text, start);
}
function wordStart(text, index) {
  if (index === 0) return true;
  const char = codePointAt(text, index);
  const previous = codePointBefore(text, index);
  return !WORD_CHAR.test(previous) || UNSPACED.test(char) || UPPER.test(char) && LOWER.test(previous);
}
var PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
var DIACRITIC = /[\u0300-\u036f]/gu;
var STROKED = {
  "\xF8": "o",
  "\xD8": "O",
  "\u0142": "l",
  "\u0141": "L",
  "\u0111": "d",
  "\u0110": "D",
  "\xF0": "d",
  "\xD0": "D",
  "\u0131": "i",
  "\u0127": "h",
  "\u0126": "H",
  "\u0167": "t",
  "\u0166": "T"
};
var STROKED_CHAR = /[øØłŁđĐðÐıħĦŧŦ]/gu;
function strip(value) {
  if (PRINTABLE_ASCII.test(value)) return value;
  return value.normalize("NFKD").replace(DIACRITIC, "").normalize("NFKC").replace(STROKED_CHAR, (char) => STROKED[char]);
}
function fold(value) {
  return strip(value).toLowerCase();
}
function prepareKeys(keys, reuse, into) {
  const fuzzy = (keys.fuzzy ?? []).flatMap((value) => {
    if (value === void 0 || value === "") return [];
    let name = into.fuzzy.get(value) ?? reuse?.fuzzy.get(value);
    if (name === void 0) {
      const stripped = strip(value);
      name = { stripped, folded: stripped.toLowerCase(), starts: void 0, tails: /* @__PURE__ */ new Map() };
    }
    into.fuzzy.set(value, name);
    return [name];
  });
  const substring = (keys.substring ?? []).flatMap((value) => {
    if (value === void 0 || value === "") return [];
    const folded = into.substring.get(value) ?? reuse?.substring.get(value) ?? fold(value);
    into.substring.set(value, folded);
    return [folded];
  });
  return { fuzzy, substring };
}
function build(items, keys, reuse) {
  const preparations = { fuzzy: /* @__PURE__ */ new Map(), substring: /* @__PURE__ */ new Map() };
  return { keys: items.map((item) => prepareKeys(keys(item), reuse, preparations)), preparations };
}
function inOrder(term, text) {
  let at = 0;
  for (const char of term) {
    at = text.indexOf(char, at);
    if (at === -1) return false;
    at += char.length;
  }
  return true;
}
function fuzzyNameScore(term, name) {
  if (!inOrder(term.folded, name.folded)) return void 0;
  if (name.starts === void 0) {
    const starts = [];
    let index = 0;
    for (const char of name.stripped) {
      if (wordStart(name.stripped, index)) starts.push(index);
      index += char.length;
    }
    name.starts = starts;
  }
  const first = codePointAt(term.stripped, 0).toLowerCase();
  let best;
  for (const start of name.starts) {
    if (codePointAt(name.stripped, start).toLowerCase() !== first) continue;
    let tail = name.tails.get(start);
    if (tail === void 0) {
      tail = import_fuzzysort.default.prepare(name.stripped.slice(start));
      name.tails.set(start, tail);
    }
    const result = import_fuzzysort.default.single(term.stripped, tail);
    if (result !== null && wordStart(name.stripped, start + result.indexes[0])) {
      best = best === void 0 ? result.score : Math.max(best, result.score);
    }
  }
  return best;
}
function termScore(term, keys) {
  let best;
  const take = (score) => {
    best = best === void 0 ? score : Math.max(best, score);
  };
  for (const name of keys.fuzzy) {
    const at = name.folded.indexOf(term.folded);
    if (at === 0) take(FUZZY_PREFIX);
    else if (at > 0) take(FUZZY_SUBSTRING);
    else {
      const score = fuzzyNameScore(term, name);
      if (score !== void 0) take(FUZZY_SUBSEQUENCE + Math.min(score, 0.99));
    }
  }
  for (const text of keys.substring) {
    if (text.includes(term.folded)) take(SUBSTRING);
  }
  return best;
}
var TextSearchIndex = class _TextSearchIndex {
  #items;
  #keys;
  #preparations;
  /**
   * Prepare every key of every item.
   * @param items - candidates in their display order, which ties keep.
   * @param keys - the search text of one item, called once per item here.
   */
  constructor(items, keys) {
    const built = build(items, keys, void 0);
    this.#items = items;
    this.#keys = built.keys;
    this.#preparations = built.preparations;
  }
  /**
   * Build the index of a changed list. Items added, removed, reordered, or
   * changed are all expressed by the complete new list; a key string that this
   * index already prepared is reused instead of prepared again, and strings no
   * item uses any more are not carried over. This index stays valid.
   * @param items - the complete new list in display order.
   * @param keys - the search text of one item, called once per item here.
   * @returns a new index over `items`.
   */
  update(items, keys) {
    const next = new _TextSearchIndex([], keys);
    const built = build(items, keys, this.#preparations);
    next.#items = items;
    next.#keys = built.keys;
    next.#preparations = built.preparations;
    return next;
  }
  /**
   * Filter and rank the indexed items by a query.
   * @param query - the user's search text.
   * @returns the build list itself when the query is blank or holds only
   * combining marks; otherwise the items matching every query term, best total
   * score first and build order on ties.
   */
  search(query) {
    const terms = query.trim().split(/\s+/u).map((term) => ({ stripped: strip(term), folded: fold(term) })).filter((term) => term.folded !== "");
    if (terms.length === 0) return this.#items;
    const ranked = [];
    this.#keys.forEach((itemKeys, index) => {
      let score = 0;
      for (const term of terms) {
        const hit = termScore(term, itemKeys);
        if (hit === void 0) return;
        score += hit;
      }
      ranked.push({ index, score });
    });
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    return ranked.map((entry) => this.#items[entry.index]);
  }
};

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelListEditor.tsx
import { Fragment as Fragment4, jsx as jsx16, jsxs as jsxs13 } from "react/jsx-runtime";
function textOf(model, key) {
  const value = model[key];
  return typeof value === "string" ? value : "";
}
function numberOf(model, key) {
  const value = model[key];
  return typeof value === "number" ? value : void 0;
}
var CAPACITY_HINT = {
  contextWindow: "1M",
  maxTokens: "128K"
};
function capacitySpelling(value) {
  return value === void 0 ? "" : formatCapacity(value);
}
function adopt(candidate) {
  return {
    id: candidate.id,
    ...candidate.name === void 0 ? {} : { name: candidate.name },
    ...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.inputModalities === void 0 ? {} : { input: [...candidate.inputModalities] }
  };
}
function ModelListEditor(props) {
  const { models, onChange, probe, operations, t, disabled, onBusyChange } = props;
  const { catalogProvider } = props;
  const [busy, setBusy] = useState5(false);
  useEffect5(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  const [failure, setFailure] = useState5(void 0);
  const [inheritedCatalog, setInheritedCatalog] = useState5(void 0);
  useEffect5(() => {
    if (catalogProvider === void 0) return;
    let current2 = true;
    void operations.discoverModels(probe.settingsNs, { provider: catalogProvider }).then((answer) => {
      if (!current2) return;
      setInheritedCatalog({ provider: catalogProvider, models: answer.kind === "found" ? answer.models : [] });
      setFailure(answer.kind === "refused" ? answer.message : void 0);
    });
    return () => {
      current2 = false;
    };
  }, [catalogProvider, operations, probe.settingsNs]);
  const catalog = inheritedCatalog?.provider === catalogProvider ? inheritedCatalog?.models : void 0;
  const inputDefaults = useMemo2(() => new Map(catalog?.map((model) => [model.id, model.inputModalities])), [catalog]);
  const [candidates, setCandidates] = useState5(void 0);
  const [flipped, setFlipped] = useState5(/* @__PURE__ */ new Set());
  const [candidateQuery, setCandidateQuery] = useState5("");
  const rowState = useModelRows(models, onChange, disabled);
  const editCapacity = (index, field, text) => {
    rowState.edit(index, field, text);
    patch(index, { [field]: parseCapacity(text) });
  };
  const capacityText = (model, index, field) => rowState.rows[index]?.editing.get(field) ?? capacitySpelling(numberOf(model, field));
  const patch = (index, next) => {
    onChange(models.map((model, at) => {
      if (at !== index) return model;
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === void 0 || value === "").map(([key]) => key)
      );
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key))
      );
    }));
  };
  const fetchModels = async () => {
    setBusy(true);
    setFailure(void 0);
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...probe.provider === void 0 ? {} : { provider: probe.provider },
        ...probe.baseURL === void 0 || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === void 0 ? {} : { api: probe.api },
        ...probe.apiKey === void 0 ? {} : { apiKey: probe.apiKey }
      });
      if (answer.kind === "refused") {
        setFailure(answer.message);
        return;
      }
      const found = answer.models;
      if (catalogProvider !== void 0) setInheritedCatalog({ provider: catalogProvider, models: found });
      if (found.length === 0) {
        setFailure(t("fetchEmpty"));
        return;
      }
      setCandidateQuery("");
      setFlipped(/* @__PURE__ */ new Set());
      setCandidates([...new Map(found.map((model) => [model.id, model])).values()]);
    } finally {
      setBusy(false);
    }
  };
  const closePicker = () => {
    setCandidates(void 0);
    setFlipped(/* @__PURE__ */ new Set());
    setCandidateQuery("");
  };
  const configuredIds = new Set(models.map((model) => textOf(model, "id")).filter((id) => id.length > 0));
  const pickedByDefault = (id) => configuredIds.size === 0 || configuredIds.has(id);
  const isPicked = (id) => pickedByDefault(id) !== flipped.has(id);
  const activeCandidates = candidates ?? [];
  const candidateIndex = useMemo2(
    () => new TextSearchIndex(candidates ?? [], (candidate) => ({ fuzzy: [candidate.id, candidate.name] })),
    [candidates]
  );
  const listed = new Set(activeCandidates.map((candidate) => candidate.id));
  const removedRows = /* @__PURE__ */ new Set();
  models.forEach((model, at) => {
    const id = textOf(model, "id");
    if (listed.has(id) && !isPicked(id)) removedRows.add(at);
  });
  const keptRows = models.filter((_model, at) => !removedRows.has(at));
  const keptIds = new Set(keptRows.map((model) => textOf(model, "id")));
  const addedRows = activeCandidates.filter((candidate) => isPicked(candidate.id) && !keptIds.has(candidate.id)).map(adopt);
  const emptiesList = models.length > 0 && keptRows.length === 0 && addedRows.length === 0;
  const adoptPicked = () => {
    onChange([...keptRows, ...addedRows]);
    rowState.forget(removedRows);
    closePicker();
  };
  const toggle = (id) => {
    setFlipped((current2) => {
      const next = new Set(current2);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const visibleCandidates = candidateIndex.search(candidateQuery);
  const allVisibleCandidatesPicked = visibleCandidates.length > 0 && visibleCandidates.every((candidate) => isPicked(candidate.id));
  const toggleVisibleCandidates = () => {
    const target = !allVisibleCandidatesPicked;
    setFlipped((current2) => {
      const next = new Set(current2);
      for (const candidate of visibleCandidates) {
        if (pickedByDefault(candidate.id) === target) next.delete(candidate.id);
        else next.add(candidate.id);
      }
      return next;
    });
  };
  const askable = probe.provider !== void 0 || probe.baseURL !== void 0 && probe.baseURL.length > 0;
  return /* @__PURE__ */ jsxs13("section", { className: ModelsSection_default["modelCatalog"], "aria-label": t("models"), children: [
    /* @__PURE__ */ jsxs13("div", { className: ModelsSection_default["modelListHead"], children: [
      /* @__PURE__ */ jsxs13("div", { className: ModelsSection_default["modelCatalogHeading"], children: [
        /* @__PURE__ */ jsx16("span", { className: ModelsSection_default["modelCatalogTitle"], children: t("models") }),
        props.overridden === void 0 ? null : /* @__PURE__ */ jsx16("span", { className: ModelsSection_default["modelCatalogMeta"], children: props.overridden ? t("modelsCustomized") : t("modelsInherited") })
      ] }),
      props.overridden === true && props.onReset !== void 0 ? /* @__PURE__ */ jsx16(
        "button",
        {
          type: "button",
          className: ModelsSection_default["linkButton"],
          disabled,
          onClick: () => {
            rowState.reset();
            props.onReset?.();
          },
          children: t("resetModels")
        }
      ) : null,
      /* @__PURE__ */ jsx16(
        "button",
        {
          type: "button",
          className: ModelsSection_default["linkButton"],
          disabled: disabled || busy || !askable || props.probeBlocked !== void 0,
          title: props.probeBlocked !== void 0 ? t(props.probeBlocked) : askable ? void 0 : t("fetchNeedsBaseUrl"),
          onClick: () => {
            void fetchModels();
          },
          children: busy ? t("fetching") : t("fetchModels")
        }
      )
    ] }),
    models.length === 0 ? /* @__PURE__ */ jsx16("p", { className: ModelsSection_default["modelEmpty"], children: t("modelsEmpty") }) : null,
    /* @__PURE__ */ jsx16(AnimatedRows, { className: ModelsSection_default["modelList"], rowKeys: rowState.rows.map((row) => String(row.key)), ready: true, resetKey: "", children: rowState.rows.map(({ model, key, expanded, order }, index) => /* @__PURE__ */ jsx16(
      ModelRow,
      {
        rowKey: key,
        order,
        model,
        position: index + 1,
        inputField: "input",
        inputFallback: inputDefaults.get(textOf(model, "id")) ?? props.defaultInput,
        inputLoading: catalogProvider !== void 0 && catalog === void 0,
        reasoningLevels: props.reasoningLevels,
        reasoningLevelsOnly: props.reasoningLevelsOnly,
        expanded,
        disabled,
        t,
        contextWindow: {
          value: capacityText(model, index, "contextWindow"),
          placeholder: CAPACITY_HINT.contextWindow,
          onChange: (text) => {
            editCapacity(index, "contextWindow", text);
          }
        },
        maxTokens: {
          value: capacityText(model, index, "maxTokens"),
          placeholder: CAPACITY_HINT.maxTokens,
          onChange: (text) => {
            editCapacity(index, "maxTokens", text);
          }
        },
        onFieldChange: (field, value) => {
          patch(index, { [field]: value });
        },
        onChange: (next) => {
          onChange(models.map((row, at) => at === index ? next : row));
        },
        onToggle: () => {
          rowState.toggle(index);
        },
        onRemove: () => {
          onChange(models.filter((_model, at) => at !== index));
          rowState.forget(/* @__PURE__ */ new Set([index]));
        }
      },
      key
    )) }),
    /* @__PURE__ */ jsxs13(
      "button",
      {
        type: "button",
        className: ModelsSection_default["addModelButton"],
        disabled,
        onClick: () => {
          onChange([...models, { id: "" }]);
        },
        children: [
          /* @__PURE__ */ jsx16(IconPlusOutlineRegular, { size: 14 }),
          t("addModel")
        ]
      }
    ),
    failure !== void 0 ? /* @__PURE__ */ jsx16("p", { className: ModelsSection_default["error"], children: failure }) : null,
    /* @__PURE__ */ jsxs13(
      Modal,
      {
        open: candidates !== void 0,
        onClose: closePicker,
        title: t("fetchTitle"),
        closeLabel: t("close"),
        description: t("fetchDescription"),
        className: ModelsSection_default["fetchDialog"],
        footer: /* @__PURE__ */ jsxs13(Fragment4, { children: [
          /* @__PURE__ */ jsx16(Button, { variant: "outline", onClick: closePicker, children: t("cancel") }),
          /* @__PURE__ */ jsx16(
            Button,
            {
              variant: "outline",
              disabled: emptiesList,
              title: emptiesList ? t("fetchKeepOne") : void 0,
              onClick: adoptPicked,
              children: t("fetchAdopt")
            }
          )
        ] }),
        children: [
          /* @__PURE__ */ jsxs13("div", { className: ModelsSection_default["candidateToolbar"], children: [
            /* @__PURE__ */ jsx16(
              "input",
              {
                className: `${ModelsSection_default["input"]} ${ModelsSection_default["candidateSearch"]}`,
                type: "search",
                value: candidateQuery,
                placeholder: t("fetchSearch"),
                "aria-label": t("fetchSearch"),
                onChange: (event) => {
                  setCandidateQuery(event.target.value);
                }
              }
            ),
            /* @__PURE__ */ jsx16(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: visibleCandidates.length === 0,
                onClick: toggleVisibleCandidates,
                children: t(allVisibleCandidatesPicked ? "fetchDeselectAll" : "fetchSelectAll")
              }
            )
          ] }),
          visibleCandidates.length === 0 ? /* @__PURE__ */ jsx16("p", { className: ModelsSection_default["candidateEmpty"], role: "status", children: t("fetchNoMatches") }) : /* @__PURE__ */ jsx16("ul", { className: ModelsSection_default["candidateList"], children: visibleCandidates.map((candidate) => /* @__PURE__ */ jsx16("li", { className: ModelsSection_default["candidate"], children: /* @__PURE__ */ jsxs13("label", { className: ModelsSection_default["candidateLabel"], children: [
            /* @__PURE__ */ jsx16(
              "input",
              {
                type: "checkbox",
                checked: isPicked(candidate.id),
                onChange: () => {
                  toggle(candidate.id);
                }
              }
            ),
            /* @__PURE__ */ jsx16("span", { className: ModelsSection_default["candidateId"], title: candidate.name ?? candidate.id, children: candidate.id })
          ] }) }, candidate.id)) })
        ]
      }
    )
  ] });
}

// desktop/compat/node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const destroy = () => {
    if ((import.meta.env ? import.meta.env.MODE : void 0) !== "production") {
      console.warn(
        "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
      );
    }
    listeners.clear();
  };
  const api = { setState, getState, getInitialState, subscribe, destroy };
  const initialState = state = createState(setState, getState, api);
  return api;
};
var createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;

// desktop/compat/node_modules/zustand/esm/middleware.mjs
var subscribeWithSelectorImpl = (fn) => (set3, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState = fn(set3, get, api);
  return initialState;
};
var subscribeWithSelector = subscribeWithSelectorImpl;

// desktop/compat/node_modules/immer/dist/immer.mjs
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");
var errors = process.env.NODE_ENV !== "production" ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (process.env.NODE_ENV !== "production") {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  return typeof Ctor == "function" && Function.toString.call(Ctor) === objectCtorString;
}
function each(obj, iter) {
  if (getArchtype(obj) === 0) {
    Reflect.ownKeys(obj).forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2)
    thing.set(propOrOldValue, value);
  else if (t === 3) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    obj.set = obj.add = obj.clear = obj.delete = dontMutateFrozenCollections;
  }
  Object.freeze(obj);
  if (deep)
    Object.entries(obj).forEach(([key, value]) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
function isFrozen(obj) {
  return Object.isFrozen(obj);
}
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 || state.type_ === 1)
    state.revoke_();
  else
    state.revoked_ = true;
}
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path)
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(rootScope, state, result, key, childValue, path, isSet2)
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (process.env.NODE_ENV !== "production" && childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !isFrozen(childValue)) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && Object.prototype.propertyIsEnumerable.call(targetObject, prop))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 : 0,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (process.env.NODE_ENV !== "production" && isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (process.env.NODE_ENV !== "production" && prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
  } else {
    copy = shallowCopy(value, true);
  }
  each(copy, (key, childValue) => {
    set(copy, key, currentImpl(childValue));
  });
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}
var immer = new Immer2();
var produce = immer.produce;
var produceWithPatches = immer.produceWithPatches.bind(
  immer
);
var setAutoFreeze = immer.setAutoFreeze.bind(immer);
var setUseStrictShallowCopy = immer.setUseStrictShallowCopy.bind(immer);
var applyPatches = immer.applyPatches.bind(immer);
var createDraft = immer.createDraft.bind(immer);
var finishDraft = immer.finishDraft.bind(immer);

// deepseek-harness/packages/client/store/src/index.ts
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`${label} subscriber failed:`, error);
    }
  }
}
function rafBatch(notify) {
  const schedule = typeof requestAnimationFrame === "function" ? (fn) => {
    requestAnimationFrame(() => {
      fn();
    });
  } : (fn) => {
    queueMicrotask(fn);
  };
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      notify();
    });
  };
}
function createSnapshotStore(init, opts) {
  const withSelector = subscribeWithSelector(() => init);
  const api = createStore()(withSelector);
  if (opts?.persist) attachPersistence(api, opts.persist.name);
  let subscribe = (fn) => api.subscribe(() => {
    notifySubscribers([fn], "[client-store]");
  });
  if (opts?.flush === "raf") {
    const listeners = /* @__PURE__ */ new Set();
    const flush = rafBatch(() => {
      notifySubscribers(listeners, "[client-store]");
    });
    api.subscribe(flush);
    subscribe = (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    };
  }
  return {
    getSnapshot: () => api.getState(),
    subscribe: (fn) => subscribe(fn),
    update: (mutator) => {
      api.setState(produce(api.getState(), (draft) => {
        mutator(draft);
      }), true);
    },
    set: (next) => {
      api.setState(devFreeze(next), true);
    }
  };
}
function attachPersistence(api, name) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(name);
    if (raw !== null) {
      api.setState(devFreeze(JSON.parse(raw)), true);
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error);
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state));
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error);
    }
  });
}
function devFreeze(value) {
  if (process.env.NODE_ENV === "production") return value;
  return freeze(value, true);
}

// deepseek-harness/packages/client/ui-settings-models/src/client/store.ts
var PROBE_ROUTE = "\0probe";
function joinProviderDirectory(registered, directory) {
  const active = new Set(registered.map((provider) => provider.id));
  const declared = new Set(directory.map((entry) => entry.provider));
  const rows = directory.map((entry) => ({
    provider: entry.provider,
    displayName: entry.displayName,
    settingsNs: entry.settingsNs,
    settingsPath: [...entry.settingsPath],
    active: active.has(entry.provider),
    ...entry.declared === void 0 ? {} : { declared: entry.declared },
    ...entry.defaultBaseURL === void 0 ? {} : { defaultBaseURL: entry.defaultBaseURL },
    ...entry.baseURLEnv === void 0 ? {} : { baseURLEnv: entry.baseURLEnv },
    ...entry.nativeAuth === void 0 ? {} : { nativeAuth: entry.nativeAuth },
    ...entry.error === void 0 ? {} : { error: entry.error }
  }));
  for (const provider of registered) {
    if (declared.has(provider.id)) continue;
    rows.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: "",
      settingsPath: [],
      active: true
    });
  }
  return rows.toSorted((left, right) => (left.provider === "deepseek-account" ? 0 : left.provider === "deepseek-official" ? 1 : 2) - (right.provider === "deepseek-account" ? 0 : right.provider === "deepseek-official" ? 1 : 2));
}
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
function protocolChoices(namespace, schema) {
  if (namespace === void 0) return [];
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ["providers", PROBE_ROUTE, "api"]);
  const list = node;
  if (list?.type !== "union" || list.list === void 0) return [];
  return list.list.map((entry) => entry.value).filter((value) => typeof value === "string");
}
function reasoningLevelChoices(namespace, schema) {
  if (namespace === void 0) return [];
  const path = ["providers", PROBE_ROUTE, "models", "0", "reasoningEfforts"];
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), path);
  const branches = node?.list ?? [];
  const keys = branches.find((branch) => branch.type === "dict")?.sKey;
  return (keys?.list ?? []).map((entry) => entry.value).filter((value) => typeof value === "string");
}
function apiKeyEnvOf(namespace, path, schema) {
  if (namespace === void 0) return void 0;
  const profile = schema.getPath(namespace.value, path);
  if (typeof profile !== "object" || profile === null) return void 0;
  const ref = profile.apiKeyEnv;
  return typeof ref === "string" && ref.length > 0 ? ref : void 0;
}
var ModelsSettingsStore = class {
  /**
   * @param ctx - the page plugin's context, whose `remote.llm` and
   * `remote.credentials` namespaces carry the directory and credential reads.
   * @param schema - settings-owned schema and immutable path operations.
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(ctx, schema, describeFace) {
    this.ctx = ctx;
    this.schema = schema;
    this.describeFace = describeFace;
  }
  /** The snapshot the section renders from (uSES-safe store). */
  store = createSnapshotStore({
    status: "idle",
    error: null,
    credentialError: null,
    writable: false,
    rows: [],
    namespaces: /* @__PURE__ */ new Map()
  });
  /** Latest load wins; an older response never overwrites a newer one. */
  generation = 0;
  /** Callers follow the current refresh's outcome, including callers whose read was superseded. */
  pendingLoads = /* @__PURE__ */ new Set();
  /**
   * Refresh the whole page snapshot: the provider directory and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. Provider failure or absence of an initial settings
   * answer keeps the last good rows and surfaces an error; a failed settings
   * refresh reuses the mirror's held view. Concurrent callers resolve only
   * after the current refresh publishes its ready or error snapshot.
   * @returns resolution after the current snapshot is published.
   * @throws the current read's unexpected rejection; superseded rejections are ignored.
   */
  load() {
    const pending = Promise.withResolvers();
    this.pendingLoads.add(pending);
    const generation = ++this.generation;
    void this.read(generation).then(
      () => {
        this.settleLoads(generation, (load) => {
          load.resolve();
        });
      },
      (error) => {
        this.settleLoads(generation, (load) => {
          load.reject(error);
        });
      }
    );
    return pending.promise;
  }
  /** Publish one joined answer; stale answers leave the current refresh in charge. */
  async read(generation) {
    this.store.update((s) => {
      s.status = "loading";
      s.error = null;
    });
    const [registered, declared] = await Promise.all([
      this.ctx.remote.llm.listProviders(),
      this.ctx.remote.llm.listConfigurableProviders(),
      this.describeFace.ensure()
    ]);
    if (generation !== this.generation) return;
    if (!registered.ok) {
      this.failLoad(registered.error.message);
      return;
    }
    if (!declared.ok) {
      this.failLoad(declared.error.message);
      return;
    }
    const mirrored = this.describeFace.getSnapshot();
    if (mirrored.view === void 0) {
      if (mirrored.error === null) throw new Error("settings describe settled with neither a view nor an error");
      this.failLoad(mirrored.error);
      return;
    }
    const providers = joinProviderDirectory(registered.value, declared.value);
    const writable = mirrored.view.writable;
    const views = mirrored.view.namespaces;
    const namespaces = new Map(views.map((view) => [view.ns, view]));
    const rows = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs);
      const configured = namespace !== void 0 && (entry.settingsPath.length === 0 || this.schema.getPath(namespace.value, entry.settingsPath) !== void 0);
      const removable = namespace !== void 0 && entry.settingsPath.length > 0 && this.schema.hasPath(namespace.user, entry.settingsPath) && !this.schema.hasPath(namespace.base, entry.settingsPath);
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: entry.provider === "deepseek-account" ? void 0 : apiKeyEnvOf(namespace, entry.settingsPath, this.schema),
        credential: void 0
      };
    });
    if (rows.some((row) => row.entry.provider === "deepseek-account")) {
      const catalog = await this.ctx.remote.session.modelCatalog();
      for (const row of rows) {
        if (row.entry.provider === "deepseek-account") row.accountAvailable = catalog.ok && catalog.value.groups.some((group) => group.id === "deepseek-account" && group.models.length > 0);
      }
    }
    const refs = [...new Set(rows.filter((row) => row.entry.provider !== "deepseek-account").flatMap((row) => row.apiKeyEnv === void 0 ? [deriveKeyRef(row.entry.provider), ...row.entry.nativeAuth?.env ?? []] : [row.apiKeyEnv]))];
    const credentials = {};
    let credentialError = null;
    for (let index = 0; index < refs.length; index += 64) {
      const response = await this.ctx.remote.credentials.describe(refs.slice(index, index + 64));
      if (response.ok) Object.assign(credentials, response.value);
      else {
        credentialError = response.error.message;
        break;
      }
    }
    if (generation !== this.generation) return;
    this.store.update((s) => {
      s.status = "ready";
      s.error = null;
      s.credentialError = credentialError;
      s.writable = writable;
      s.rows = rows.filter((row) => row.entry.provider !== "deepseek-account" || row.accountAvailable === true).map((row) => {
        if (row.entry.provider === "deepseek-account") return row;
        const named = row.apiKeyEnv === void 0 ? void 0 : credentials[row.apiKeyEnv];
        const derived = row.apiKeyEnv !== void 0 ? void 0 : credentials[deriveKeyRef(row.entry.provider)];
        return {
          ...row,
          ...named === void 0 ? {} : { credential: named },
          ...derived === void 0 ? {} : { derivedCredential: derived },
          ...credentialError === null ? { credentialChecks: Object.fromEntries(
            (row.apiKeyEnv === void 0 ? row.entry.nativeAuth?.env ?? [] : [row.apiKeyEnv]).flatMap((ref) => {
              const info = credentials[ref];
              return info === void 0 ? [] : [[ref, info]];
            })
          ) } : {}
        };
      });
      s.namespaces = namespaces;
    });
  }
  /** Settle callers only while this read still owns the current refresh. */
  settleLoads(generation, settle) {
    if (generation !== this.generation) return;
    const pending = [...this.pendingLoads];
    this.pendingLoads.clear();
    for (const load of pending) settle(load);
  }
  /** Publish the current joined read's failure text. */
  failLoad(message) {
    this.store.update((s) => {
      s.status = "error";
      s.error = message;
    });
  }
};
function providerUsable(row) {
  if (!row.entry.active) return false;
  if (row.entry.provider === "deepseek-account") return row.accountAvailable === true;
  if (row.apiKeyEnv === void 0) return true;
  return row.credential?.configured === true;
}

// deepseek-harness/packages/client/ui-settings-models/src/client/protocol-label.ts
var PROTOCOL_LABEL_KEYS = {
  "openai-completions": "protocolOpenAiCompletions",
  "openai-responses": "protocolOpenAiResponses",
  "anthropic-messages": "protocolAnthropicMessages",
  "google-generative-ai": "protocolGemini"
};
function protocolLabel(t, protocol) {
  const key = PROTOCOL_LABEL_KEYS[protocol];
  return key === void 0 ? protocol : t(key);
}

// deepseek-harness/packages/client/ui-settings-models/src/client/protocol-rules.ts
var GEMINI = "google-generative-ai";
var GEMINI_LEVELS = ["minimal", "low", "medium", "high"];
function protocolNeedsKey(protocol) {
  return protocol === GEMINI;
}
function protocolReasoningLevels(protocol, levels) {
  if (protocol !== GEMINI) return { levels, levelsOnly: false };
  return { levels: levels.filter((level) => GEMINI_LEVELS.includes(level)), levelsOnly: true };
}

// deepseek-harness/packages/client/ui-settings-models/src/client/CustomProviderCard.tsx
import { jsx as jsx17, jsxs as jsxs14 } from "react/jsx-runtime";
var NS = "llm-pi-ai";
var ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
var BASE_URL_PLACEHOLDERS = {
  "anthropic-messages": "customAnthropicBaseUrlPlaceholder",
  "google-generative-ai": "customGeminiBaseUrlPlaceholder"
};
function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
function CustomProviderCard(props) {
  const { taken, protocols, reasoningLevels, operations, t, onBusyChange } = props;
  const [openedAt] = useState6(() => props.revision);
  const [route, setRoute] = useState6("");
  const [displayName, setDisplayName] = useState6("");
  const [baseURL, setBaseURL] = useState6("");
  const [protocol, setProtocol] = useState6(protocols[0] ?? "");
  const [keyDraft, setKeyDraft] = useState6("");
  const [models, setModels] = useState6([]);
  const [busy, setBusy] = useState6(false);
  const [listBusy, setListBusy] = useState6(false);
  useEffect6(() => {
    onBusyChange?.(busy || listBusy);
  }, [busy, listBusy, onBusyChange]);
  const [failure, setFailure] = useState6(void 0);
  const [committed, setCommitted] = useState6(false);
  const disabled = props.readOnly || busy;
  const profileDisabled = disabled || committed;
  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route);
  const routeTaken = taken.includes(route);
  const normalizedBaseURL = baseURL.trim();
  const baseUrlInvalid = baseURL.length > 0 && !isHttpUrl(normalizedBaseURL);
  const reasoning = protocolReasoningLevels(protocol, reasoningLevels);
  const modelFailure = validateDeepSeekModels(models) ?? validateReasoningEfforts(models, reasoning.levelsOnly ? reasoning.levels : void 0);
  const keyMissing = protocolNeedsKey(protocol) && keyDraft.trim().length === 0;
  const keyFailure = keyMissing ? "keyRequired" : apiKeyFailure(keyDraft);
  const keyValue = keyDraft.trim();
  const ready = route.length > 0 && !routeInvalid && !routeTaken && normalizedBaseURL.length > 0 && !baseUrlInvalid && models.length > 0 && modelFailure === void 0 && keyFailure === void 0;
  const hint = failure !== void 0 || ready || keyFailure !== void 0 || route.length === 0 || routeInvalid || routeTaken || baseUrlInvalid ? void 0 : normalizedBaseURL.length === 0 ? t("customNeedsBaseUrl") : modelFailure !== void 0 ? `${t("model")} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}` : t("customNeedsModels");
  const createOnce = async () => {
    const keyRef = deriveKeyRef(route);
    const storesKey = keyValue.length > 0;
    if (!committed) {
      const profile = {
        ...displayName.length === 0 ? {} : { displayName },
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: protocol,
        baseURL: normalizedBaseURL,
        models: models.map((model) => ({ ...model }))
      };
      const written = await operations.writeSettings(
        NS,
        [{ op: "set", path: ["providers", route], value: profile }],
        openedAt
      );
      if (written.kind !== "written") {
        return written.kind === "conflict" ? t("conflict") : written.message;
      }
      setCommitted(true);
    }
    if (storesKey) {
      const stored = await operations.storeCredential(keyRef, keyValue);
      if (stored !== void 0) return stored;
    }
    return void 0;
  };
  const create = async () => {
    setBusy(true);
    setFailure(void 0);
    try {
      const outcome = await createOnce();
      if (outcome !== void 0) {
        setFailure(outcome);
        return;
      }
      props.onClose(true);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["editor"], children: [
    /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["field"], children: [
      /* @__PURE__ */ jsx17("span", { className: ModelsSection_default["fieldLabel"], children: t("customRoute") }),
      /* @__PURE__ */ jsx17(
        "input",
        {
          className: ModelsSection_default["input"],
          type: "text",
          value: route,
          placeholder: "acme-gateway",
          "aria-label": t("customRoute"),
          disabled: profileDisabled,
          onChange: (event) => {
            setRoute(event.target.value);
          }
        }
      )
    ] }),
    routeInvalid || routeTaken ? /* @__PURE__ */ jsx17("p", { className: ModelsSection_default["error"], children: t(routeInvalid ? "customRouteInvalid" : "customRouteTaken") }) : /* @__PURE__ */ jsx17("p", { className: ModelsSection_default["advancedHint"], children: t("customRouteHint") }),
    /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["field"], children: [
      /* @__PURE__ */ jsx17("span", { className: ModelsSection_default["fieldLabel"], children: t("customDisplayName") }),
      /* @__PURE__ */ jsx17(
        "input",
        {
          className: ModelsSection_default["input"],
          type: "text",
          value: displayName,
          placeholder: route.length === 0 ? t("customDisplayName") : route,
          "aria-label": t("customDisplayName"),
          disabled: profileDisabled,
          onChange: (event) => {
            setDisplayName(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["field"], children: [
      /* @__PURE__ */ jsx17("span", { className: ModelsSection_default["fieldLabel"], children: t("baseUrl") }),
      /* @__PURE__ */ jsx17(
        "input",
        {
          className: ModelsSection_default["input"],
          type: "text",
          value: baseURL,
          placeholder: t(BASE_URL_PLACEHOLDERS[protocol] ?? "customBaseUrlPlaceholder"),
          "aria-label": t("baseUrl"),
          "aria-invalid": baseUrlInvalid,
          disabled: profileDisabled,
          onChange: (event) => {
            setBaseURL(event.target.value);
          }
        }
      )
    ] }),
    baseUrlInvalid ? /* @__PURE__ */ jsx17("p", { className: ModelsSection_default["error"], children: t("customBaseUrlInvalid") }) : null,
    /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["field"], children: [
      /* @__PURE__ */ jsx17("span", { className: ModelsSection_default["fieldLabel"], children: t("customApi") }),
      /* @__PURE__ */ jsx17(
        "select",
        {
          className: `${ModelsSection_default["input"]} ${ModelsSection_default["selectInput"]}`,
          value: protocol,
          "aria-label": t("customApi"),
          disabled: profileDisabled,
          onChange: (event) => {
            setProtocol(event.target.value);
          },
          children: protocols.map((choice) => /* @__PURE__ */ jsx17("option", { value: choice, children: protocolLabel(t, choice) }, choice))
        }
      )
    ] }),
    /* @__PURE__ */ jsxs14("div", { className: ModelsSection_default["field"], children: [
      /* @__PURE__ */ jsx17("span", { className: ModelsSection_default["fieldLabel"], children: t("keyInput") }),
      /* @__PURE__ */ jsx17(
        ApiKeyInput,
        {
          t,
          value: keyDraft,
          placeholder: t("keyPlaceholder"),
          "aria-label": t("keyInput"),
          required: protocolNeedsKey(protocol),
          disabled,
          onChange: (event) => {
            setKeyDraft(event.target.value);
          }
        }
      ),
      keyFailure === void 0 ? null : /* @__PURE__ */ jsx17("p", { className: ModelsSection_default[keyMissing ? "advancedHint" : "error"], children: t(keyFailure === "keyBlank" ? "keyBlankNew" : keyFailure) })
    ] }),
    /* @__PURE__ */ jsx17(
      ModelListEditor,
      {
        models,
        onChange: setModels,
        reasoningLevels: reasoning.levels,
        reasoningLevelsOnly: reasoning.levelsOnly,
        probe: {
          settingsNs: NS,
          baseURL: normalizedBaseURL,
          api: protocol,
          ...keyValue.length === 0 ? {} : { apiKey: keyValue }
        },
        probeBlocked: baseUrlInvalid ? "customBaseUrlInvalid" : keyFailure === "keyBlank" ? "keyBlankNew" : keyFailure,
        operations,
        t,
        disabled: profileDisabled,
        onBusyChange: setListBusy
      }
    ),
    failure !== void 0 ? /* @__PURE__ */ jsx17("p", { className: ModelsSection_default["error"], children: failure }) : null,
    hint === void 0 ? null : /* @__PURE__ */ jsx17("p", { className: ModelsSection_default["advancedHint"], children: hint }),
    /* @__PURE__ */ jsx17(
      EditorFooter,
      {
        t,
        busy,
        submitDisabled: disabled || !ready,
        submitLabelKey: "create",
        submitBusyLabelKey: "creating",
        onCancel: () => {
          props.onClose(committed);
        },
        onSubmit: () => {
          void create();
        }
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ProviderEditor.tsx
import { useEffect as useEffect7, useMemo as useMemo3, useState as useState8 } from "react";

// deepseek-harness/packages/client/ui-settings-models/src/client/RetryPolicyEditor.tsx
import { useState as useState7 } from "react";
import { jsx as jsx18, jsxs as jsxs15 } from "react/jsx-runtime";
var LABELS = /* @__PURE__ */ new Map([
  ["normal", "retryModeNormal"],
  ["always", "retryModeAlways"],
  ["maxRetries", "retryMaxRetries"],
  ["retryableCodes", "retryCodes"],
  ["backoff", "retryBackoff"],
  ["initialDelayMs", "retryInitialDelay"],
  ["maxDelayMs", "retryMaxDelay"],
  ["jitterRatio", "retryJitter"]
]);
var MODE_HINTS = /* @__PURE__ */ new Map([["always", "retryAlwaysHint"]]);
var CODE_LABELS = /* @__PURE__ */ new Map([
  ["EMPTY_RESPONSE", "retryCodeEmptyResponse"],
  ["RATE_LIMIT", "retryCodeRateLimit"],
  ["SERVER", "retryCodeServer"],
  ["TIMEOUT", "retryCodeTimeout"],
  ["TRANSPORT", "retryCodeTransport"],
  ["STREAM_CLOSED", "retryCodeStreamClosed"],
  ["MALFORMED_RESPONSE", "retryCodeMalformedResponse"],
  ["QUOTA", "retryCodeQuota"]
]);
var DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu;
var DELAY_ORDER = [["backoff", "initialDelayMs"], ["backoff", "maxDelayMs"]];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fieldAt(value, path) {
  return path.reduce((node, key) => isRecord(node) ? node[key] : void 0, value);
}
function modeOf(branch) {
  const mode = branch.dict?.["mode"]?.value;
  return typeof mode === "string" ? mode : void 0;
}
function choicesOf(node) {
  return (node.inner?.list ?? []).flatMap((branch) => {
    const value = branch.type === "const" ? branch.value : void 0;
    return typeof value === "string" ? [value] : [];
  });
}
function fieldsOf(node) {
  return Object.entries(node.dict ?? {}).filter(([key]) => key !== "mode");
}
function retryPolicyDefaults(schema, node, inherited) {
  const branches = new Map((node.list ?? []).flatMap((branch) => {
    const mode = modeOf(branch);
    return mode === void 0 ? [] : [[mode, branch]];
  }));
  const modes = [...branches.keys()];
  const stored = schema.getPath(inherited, ["mode"]);
  return {
    modes,
    mode: typeof stored === "string" && branches.has(stored) ? stored : modes[0] ?? "",
    branch: (mode) => typeof mode === "string" ? branches.get(mode) : void 0,
    value: (branch, path) => {
      const value = schema.getPath(inherited, path);
      if (value !== void 0) return value;
      const fallback = schema.nodeAtPath(branch, path)?.meta.default;
      return fallback;
    }
  };
}
function numberFailure(node, value, t) {
  if (typeof value !== "number" || !Number.isFinite(value)) return t("retryValueNumber");
  const { min, max, step } = node.meta;
  if (step === 1 && !Number.isInteger(value)) return t("retryValueInteger");
  if (min === Number.MIN_VALUE && value <= 0) return t("retryValuePositive");
  if (typeof min === "number" && value < min) return t("retryValueMin").replace("{min}", () => String(min));
  if (typeof max === "number" && value > max) return t("retryValueMax").replace("{max}", () => String(max));
  return void 0;
}
function retryPolicyFailure(schema, node, policy, defaults, t) {
  if (policy === void 0) return void 0;
  const whole = () => {
    const message = schema.validate(node, policy);
    return message === void 0 ? void 0 : { message };
  };
  if (!isRecord(policy)) return whole();
  const branch = defaults.branch(policy["mode"]);
  if (branch === void 0) return whole();
  const read = (path) => schema.getPath(policy, path) ?? defaults.value(branch, path);
  const check = (owner, base) => {
    for (const [key, field] of fieldsOf(owner)) {
      const path = [...base, key];
      if (field.type === "object") {
        const nested = check(field, path);
        if (nested !== void 0) return nested;
      } else if (field.type === "number") {
        const value = read(path);
        const message = value === void 0 ? void 0 : numberFailure(field, value, t);
        if (message !== void 0) return { message, path };
      } else if (field.type === "array") {
        const stored = schema.getPath(policy, path);
        if (stored === void 0) continue;
        if (schema.validate(field, stored) !== void 0) return { message: t("retryCodesInvalid"), path };
        if (Array.isArray(stored) && new Set(stored).size !== stored.length) return { message: t("retryCodesDuplicate"), path };
      }
    }
    return void 0;
  };
  const failure = check(branch, []);
  if (failure !== void 0) return failure;
  const [lowerPath, upperPath] = DELAY_ORDER;
  const lower = read(lowerPath);
  const upper = read(upperPath);
  if (typeof lower === "number" && typeof upper === "number" && lower > upper) {
    return { message: t("retryDelayOrder"), path: lowerPath };
  }
  return whole();
}
function textOf2(value) {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}
function withField(policy, path, value) {
  const [key, ...rest] = path;
  if (key === void 0) return policy;
  const result = { ...policy };
  const prior = result[key];
  const next = rest.length === 0 ? value : withField(isRecord(prior) ? prior : {}, rest, value);
  if (next === void 0 || isRecord(next) && Object.keys(next).length === 0) Reflect.deleteProperty(result, key);
  else result[key] = next;
  return result;
}
function RetryPolicyEditor(props) {
  const { t, disabled, defaults, failure } = props;
  const current2 = isRecord(props.policy) ? props.policy : {};
  const branch = defaults.branch(current2["mode"]);
  const mode = branch === void 0 ? void 0 : String(current2["mode"]);
  const [texts, setTexts] = useState7({});
  const [added, setAdded] = useState7({});
  const [openFolds] = useState7(() => new Set(Object.keys(current2).filter((key) => isRecord(current2[key]))));
  const label = (key) => {
    const labelKey = LABELS.get(key);
    return labelKey === void 0 ? key : t(labelKey);
  };
  const invalidAt = (path) => failure?.path?.join(".") === path.join(".");
  const numberField = (root, path, node, className) => {
    const id = path.join(".");
    const invalid = invalidAt(path);
    const storedValue = fieldAt(current2, path);
    return /* @__PURE__ */ jsxs15("label", { className, children: [
      /* @__PURE__ */ jsx18("span", { className: ModelsSection_default["modelFieldLabel"], children: label(path[path.length - 1]) }),
      /* @__PURE__ */ jsx18(
        "input",
        {
          className: ModelsSection_default["input"],
          type: "text",
          inputMode: node.meta.step === 1 ? "numeric" : "decimal",
          value: texts[id] ?? textOf2(storedValue),
          placeholder: textOf2(defaults.value(root, path)),
          "aria-invalid": invalid,
          "aria-describedby": invalid ? props.failureId : void 0,
          disabled,
          onChange: (event) => {
            const trimmed = event.target.value.trim();
            setTexts((previous) => ({ ...previous, [id]: trimmed.length === 0 ? "" : event.target.value }));
            const value = DECIMAL.test(trimmed) ? Number(trimmed) : trimmed;
            props.onChange(withField(current2, path, value === "" ? void 0 : value));
          }
        }
      )
    ] }, id);
  };
  const codesField = (root, path, node) => {
    const id = path.join(".");
    const strings = (value) => Array.isArray(value) ? value.filter((code) => typeof code === "string") : [];
    const inherited = strings(defaults.value(root, path));
    const storedCodes = fieldAt(current2, path);
    const selected = Array.isArray(storedCodes) ? strings(storedCodes) : inherited;
    const choices = [.../* @__PURE__ */ new Set([...choicesOf(node), ...inherited, ...selected, ...added[id] ?? []])];
    const invalid = invalidAt(path);
    const select = (next) => {
      const inherits = next.length === inherited.length && next.every((value) => inherited.includes(value));
      props.onChange(withField(current2, path, inherits ? void 0 : [...next]));
    };
    const draftCode = (texts[id] ?? "").trim();
    const add = () => {
      if (draftCode.length === 0) return;
      setAdded((previous) => ({ ...previous, [id]: [.../* @__PURE__ */ new Set([...previous[id] ?? [], draftCode])] }));
      setTexts((previous) => ({ ...previous, [id]: "" }));
      if (!selected.includes(draftCode)) select([...selected, draftCode]);
    };
    return /* @__PURE__ */ jsxs15(
      "fieldset",
      {
        className: ModelsSection_default["modelInputTypes"],
        "aria-invalid": invalid,
        "aria-describedby": invalid ? props.failureId : void 0,
        children: [
          /* @__PURE__ */ jsx18("legend", { className: ModelsSection_default["modelFieldLabel"], children: label(path[path.length - 1]) }),
          /* @__PURE__ */ jsx18("div", { className: ModelsSection_default["retryCodeChoices"], children: choices.map((code) => {
            const labelKey = CODE_LABELS.get(code);
            return /* @__PURE__ */ jsx18(
              Checkbox,
              {
                label: labelKey === void 0 ? code : t(labelKey),
                checked: selected.includes(code),
                disabled: disabled || selected.length === 1 && selected.includes(code),
                onChange: (checked) => {
                  select(choices.filter((value) => value === code ? checked : selected.includes(value)));
                }
              },
              code
            );
          }) }),
          /* @__PURE__ */ jsxs15("div", { className: ModelsSection_default["retryCodeAdd"], children: [
            /* @__PURE__ */ jsx18(
              "input",
              {
                className: ModelsSection_default["input"],
                type: "text",
                value: texts[id] ?? "",
                placeholder: t("retryCodeCustom"),
                "aria-label": t("retryCodeCustom"),
                disabled,
                onChange: (event) => {
                  const value = event.target.value;
                  setTexts((previous) => ({ ...previous, [id]: value }));
                },
                onKeyDown: (event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  add();
                }
              }
            ),
            /* @__PURE__ */ jsx18(
              "button",
              {
                type: "button",
                className: ModelsSection_default["secondaryButton"],
                disabled: disabled || draftCode.length === 0,
                onClick: add,
                children: t("retryCodeAdd")
              }
            )
          ] })
        ]
      },
      path.join(".")
    );
  };
  const fields = (root, owner, base) => fieldsOf(owner).map(([key, node]) => {
    const path = [...base, key];
    if (node.type === "number") {
      return numberField(root, path, node, base.length === 0 ? `${ModelsSection_default["modelField"]} ${ModelsSection_default["retryCount"]}` : ModelsSection_default["modelField"]);
    }
    if (node.type === "array") return codesField(root, path, node);
    if (node.type === "object") {
      return /* @__PURE__ */ jsxs15("details", { className: ModelsSection_default["retryFold"], open: openFolds.has(key), children: [
        /* @__PURE__ */ jsx18("summary", { className: ModelsSection_default["customizedSummary"], children: label(key) }),
        /* @__PURE__ */ jsx18("div", { className: ModelsSection_default["retryBackoff"], children: fields(root, node, path) })
      ] }, key);
    }
    return null;
  });
  const labelId = `${props.failureId}-label`;
  const hint = mode === void 0 ? void 0 : MODE_HINTS.get(mode);
  return /* @__PURE__ */ jsxs15("div", { className: ModelsSection_default["field"], role: "group", "aria-labelledby": labelId, children: [
    /* @__PURE__ */ jsx18("span", { id: labelId, className: ModelsSection_default["fieldLabel"], children: t("retryPolicy") }),
    /* @__PURE__ */ jsxs15(
      "select",
      {
        className: `${ModelsSection_default["input"]} ${ModelsSection_default["selectInput"]}`,
        value: mode ?? "",
        "aria-labelledby": labelId,
        "aria-describedby": failure !== void 0 && failure.path === void 0 ? props.failureId : void 0,
        disabled,
        onChange: (event) => {
          const next = defaults.branch(event.target.value);
          setTexts({});
          if (next === void 0) {
            props.onChange(void 0);
            return;
          }
          const declared = new Set(fieldsOf(next).map(([key]) => key));
          const kept = Object.fromEntries(Object.entries(current2).filter(([key]) => declared.has(key)));
          props.onChange({ ...kept, mode: event.target.value });
        },
        children: [
          /* @__PURE__ */ jsx18("option", { value: "", children: t("retryModeDefault").replace("{mode}", () => label(defaults.mode)) }),
          defaults.modes.map((value) => /* @__PURE__ */ jsx18("option", { value, children: label(value) }, value))
        ]
      }
    ),
    hint === void 0 ? null : /* @__PURE__ */ jsx18("span", { className: ModelsSection_default["advancedHint"], children: t(hint) }),
    branch === void 0 ? null : /* @__PURE__ */ jsx18("div", { className: ModelsSection_default["retryBody"], children: fields(branch, branch, []) }),
    failure === void 0 || !props.showFailure ? null : /* @__PURE__ */ jsx18("p", { id: props.failureId, className: ModelsSection_default["error"], children: failure.message })
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ProviderEditor.tsx
import { Fragment as Fragment5, jsx as jsx19, jsxs as jsxs16 } from "react/jsx-runtime";
function draftAt(schema, namespace, path) {
  const subtree = schema.getPath(namespace.user, path);
  if (typeof subtree !== "object" || subtree === null || Array.isArray(subtree)) return {};
  return structuredClone(subtree);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pathOps(base, before, after) {
  const previous = isRecord2(before) ? before : {};
  const ops = [];
  for (const [key, value] of Object.entries(after)) {
    const prior = previous[key];
    if (JSON.stringify(prior) === JSON.stringify(value)) continue;
    if (isRecord2(value) && (prior === void 0 || isRecord2(prior))) ops.push(...pathOps([...base, key], prior, value));
    else ops.push({ op: "set", path: [...base, key], value });
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: "unset", path: [...base, key] });
  }
  return ops;
}
function layoutOf(ns) {
  if (ns === "llm-deepseek") return "deepseek";
  if (ns === "llm-pi-ai") return "pi-ai";
  return "unknown";
}
function refFor(schema, namespace, path, provider) {
  const profile = schema.getPath(namespace.value, path);
  const named = typeof profile === "object" && profile !== null ? profile.apiKeyEnv : void 0;
  return typeof named === "string" && named.length > 0 ? named : deriveKeyRef(provider);
}
function ProviderEditor(props) {
  const { namespace, schema, settingsPath, operations, t } = props;
  const [draft, setDraft] = useState8(() => {
    const loaded = draftAt(schema, namespace, settingsPath);
    const policy = loaded["retryPolicy"];
    if (!isRecord2(policy) || policy["mode"] !== void 0) return loaded;
    const path = [...settingsPath, "retryPolicy"];
    const node2 = schema.nodeAtPath(schema.rehydrate(namespace.schema), path);
    if (node2 === void 0) return loaded;
    const { mode } = retryPolicyDefaults(schema, node2, schema.getPath(namespace.base, path));
    return { ...loaded, retryPolicy: { ...policy, mode } };
  });
  const [keyDraft, setKeyDraft] = useState8();
  const keyText = typeof keyDraft === "string" ? keyDraft : "";
  const keyRemoval = typeof keyDraft === "object" ? keyDraft : void 0;
  const [busy, setBusy] = useState8(false);
  const [listBusy, setListBusy] = useState8(false);
  const { onBusyChange } = props;
  useEffect7(() => {
    onBusyChange?.(busy || listBusy);
  }, [busy, listBusy, onBusyChange]);
  const [failure, setFailure] = useState8(void 0);
  const [customizedOpen, setCustomizedOpen] = useState8(false);
  const [committedOriginal, setCommittedOriginal] = useState8(
    () => schema.getPath(namespace.user, settingsPath)
  );
  const [expectedRevision, setExpectedRevision] = useState8(() => namespace.revision);
  const root = useMemo3(() => schema.rehydrate(namespace.schema), [namespace.schema, schema]);
  const node = useMemo3(() => schema.nodeAtPath(root, settingsPath), [root, schema, settingsPath]);
  const fallback = schema.getPath(namespace.value, settingsPath);
  const disabled = props.readOnly || busy;
  const layout = layoutOf(namespace.ns);
  const keyRef = refFor(schema, namespace, settingsPath, props.provider);
  const protocols = useMemo3(
    () => layout === "pi-ai" ? protocolChoices(namespace, schema) : [],
    [layout, namespace, schema]
  );
  const stringAt = (source, key) => {
    const value = schema.getPath(source, [key]);
    return typeof value === "string" && value.trim().length > 0 ? value : void 0;
  };
  const setField = (key, next) => {
    const value = next === void 0 || next.trim().length === 0 ? void 0 : next;
    setDraft((current2) => value === void 0 ? schema.deletePath(current2, [key]) : schema.setPath(current2, [key], value));
  };
  const clearsDerivedRef = keyRemoval !== void 0 && layout === "pi-ai" && props.nativeAuth !== void 0 && stringAt(draft, "apiKeyEnv") === deriveKeyRef(props.provider);
  const schemaReasoningLevels = useMemo3(
    () => layout === "pi-ai" && props.declared === true ? reasoningLevelChoices(namespace, schema) : [],
    [layout, props.declared, namespace, schema]
  );
  const probeApi = stringAt(draft, "api") ?? stringAt(fallback, "api");
  const reasoning = protocolReasoningLevels(probeApi, schemaReasoningLevels);
  const editsReasoning = reasoning.levels.length > 0;
  const validateModels = (value) => validateDeepSeekModels(value) ?? (editsReasoning ? validateReasoningEfforts(value, reasoning.levelsOnly ? reasoning.levels : void 0) : void 0);
  const modelFailure = validateModels(schema.getPath(draft, ["models"]) ?? (reasoning.levelsOnly ? schema.getPath(fallback, ["models"]) : void 0));
  const retryNode = useMemo3(
    () => layout === "unknown" ? void 0 : schema.nodeAtPath(root, [...settingsPath, "retryPolicy"]),
    [layout, root, schema, settingsPath]
  );
  const retryDefaults = retryNode === void 0 ? void 0 : retryPolicyDefaults(schema, retryNode, schema.getPath(namespace.base, [...settingsPath, "retryPolicy"]));
  const retryFailure = retryNode === void 0 || retryDefaults === void 0 || props.credentialOnly === true ? void 0 : retryPolicyFailure(schema, retryNode, schema.getPath(draft, ["retryPolicy"]), retryDefaults, t);
  const keyFailure = apiKeyFailure(keyText);
  const keyValue = keyText.trim();
  const protocolNeedsKeyHere = layout === "pi-ai" && protocolNeedsKey(probeApi) && stringAt(draft, "apiKeyEnv") === void 0 && stringAt(fallback, "apiKeyEnv") === void 0;
  const protocolKeyMissing = protocolNeedsKeyHere && keyValue.length === 0;
  const credentialRequiredFailure = props.credentialRequired === true && keyText.length > 0 && keyValue.length === 0 || protocolKeyMissing ? "keyRequired" : void 0;
  const shownKeyFailure = credentialRequiredFailure ?? keyFailure;
  const probeBaseURL = stringAt(draft, "baseURL") ?? stringAt(fallback, "baseURL");
  const probe = {
    settingsNs: namespace.ns,
    // Naming the route lets an adapter that already describes it answer from
    // its own registry — better metadata, no network call, no endpoint needed.
    provider: props.provider,
    ...probeBaseURL === void 0 ? {} : { baseURL: probeBaseURL },
    ...probeApi === void 0 ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue }
  };
  const applyOnce = async () => {
    const ns = namespace.ns;
    const profileDraft = clearsDerivedRef ? schema.deletePath(draft, ["apiKeyEnv"]) : draft;
    const next = layout === "pi-ai" && stringAt(profileDraft, "apiKeyEnv") === void 0 && stringAt(schema.getPath(namespace.base, settingsPath), "apiKeyEnv") === void 0 && keyValue.length > 0 ? schema.setPath(profileDraft, ["apiKeyEnv"], keyRef) : profileDraft;
    if (props.credentialOnly !== true) {
      const failure2 = validateModels(schema.getPath(next, ["models"]));
      if (failure2 !== void 0) {
        return `${t("model")} ${String(failure2.index + 1)}: ${t(failure2.key)}`;
      }
    }
    if (props.credentialOnly !== true && node !== void 0 && settingsPath.length === 0) {
      const sectionError = schema.validate(node, next);
      if (sectionError !== void 0) return sectionError;
    }
    const materializesNativeProfile = layout === "pi-ai" && fallback === void 0 && committedOriginal === void 0 && Object.keys(next).length === 0;
    const ops = props.credentialOnly === true ? [] : materializesNativeProfile ? [{ op: "set", path: [...settingsPath], value: {} }] : pathOps(settingsPath, committedOriginal, next);
    if (keyRemoval !== void 0 && keyRemoval.removed !== true) {
      const removed = await operations.removeCredential(keyRemoval.ref);
      if (removed !== void 0) return removed;
      setKeyDraft({ ...keyRemoval, removed: true });
    }
    if (ops.length > 0) {
      const written = await operations.writeSettings(ns, ops, expectedRevision);
      if (written.kind !== "written") return written.kind === "conflict" ? t("conflict") : written.message;
      setCommittedOriginal(schema.getPath(written.view.user, settingsPath));
      setExpectedRevision(written.view.revision);
      setDraft(next);
    }
    if (keyValue.length > 0) {
      const stored = await operations.storeCredential(keyRef, keyValue);
      if (stored !== void 0) return stored;
    }
    setKeyDraft("");
    return void 0;
  };
  const apply = async () => {
    setBusy(true);
    setFailure(void 0);
    try {
      const failure2 = await applyOnce();
      if (failure2 !== void 0) {
        setFailure(failure2);
        return;
      }
      props.onClose(true);
    } finally {
      setBusy(false);
    }
  };
  if (node === void 0) {
    return /* @__PURE__ */ jsxs16("p", { className: ModelsSection_default["error"], children: [
      props.provider,
      ": ",
      props.t("settingsPathUnresolvable")
    ] });
  }
  const inheritedModels = () => {
    const pinned = schema.getPath(namespace.base, [...settingsPath, "models"]);
    return pinned ?? schema.nodeAtPath(root, [...settingsPath, "models"])?.meta.default;
  };
  const curatedFields = (family) => {
    const ownsIdentity = family === "pi-ai" && props.declared === true;
    const customModels = schema.getPath(draft, ["models"]);
    const modelsOverridden = schema.hasPath(draft, ["models"]);
    const models = modelDrafts(modelsOverridden ? customModels : inheritedModels());
    const defaultContextWindow = schema.getPath(fallback, ["defaultContextWindow"]);
    const defaultMaxTokens = schema.getPath(fallback, ["maxTokens"]);
    const defaultInput = schema.getPath(fallback, ["defaultInput"]);
    const baseURL = stringAt(fallback, "baseURL") ?? props.defaultBaseURL;
    const endpointEnv = props.baseURLEnv ?? [];
    const endpointHint = family === "deepseek" ? t("deepSeekEndpointHint") : baseURL === void 0 && endpointEnv.length > 0 ? t("baseUrlEnvironment").replace("{env}", () => endpointEnv.join(", ")) : void 0;
    const namedRef = clearsDerivedRef ? stringAt(schema.getPath(namespace.base, settingsPath), "apiKeyEnv") : stringAt(fallback, "apiKeyEnv");
    const nativeAuth = namedRef === void 0 ? props.nativeAuth : void 0;
    const authRefs = namedRef === void 0 ? (nativeAuth?.env ?? []).filter((ref) => !endpointEnv.includes(ref)) : [namedRef];
    const visibleRefs = authRefs.filter((ref) => !ref.toLowerCase().includes("oauth"));
    const keyHint = visibleRefs[0];
    const checkedRefs = authRefs.map((ref) => [
      ref,
      props.credentialChecks?.[ref] ?? (ref === namedRef ? props.credential : void 0)
    ]);
    const detected = checkedRefs.find(([, info]) => info?.configured === true);
    const detectedRef = detected?.[0];
    const detectedVisibleRef = detectedRef === void 0 || !visibleRefs.includes(detectedRef) ? void 0 : detectedRef;
    const missingRefs = checkedRefs.length > 0 && checkedRefs.every(([, info]) => info?.configured === false);
    const savedCredential = detected?.[1]?.source === "file" && detectedVisibleRef !== void 0;
    const credentialHint = props.credentialRequired === true ? void 0 : keyText.length > 0 ? savedCredential ? t("keyReplacePending") : void 0 : keyRemoval !== void 0 ? keyRemoval.removed === true ? t("keyRemoveApplied") : keyHint === void 0 ? t("keyRemovePending") : t("keyRemovePendingEnvironment").replace("{hint}", () => keyHint) : keyHint === void 0 ? void 0 : savedCredential ? t("keySaved") : t(detectedRef === void 0 ? missingRefs ? "keyFallbackMissing" : "keyFallbackUnchecked" : detectedVisibleRef === void 0 ? "keyFallbackDetectedHidden" : "keyFallbackDetected").replace("{hint}", () => detectedVisibleRef ?? keyHint);
    const keyHelp = visibleRefs.length === 0 ? void 0 : t("keyHelp").replace("{env}", () => visibleRefs.join(" / "));
    const authHelp = keyHelp === void 0 ? null : /* @__PURE__ */ jsx19(Tooltip, { label: keyHelp, side: "right", delayMs: 0, focusDelayMs: 0, portal: true, openOnClick: true, children: /* @__PURE__ */ jsx19("button", { type: "button", className: ModelsSection_default["helpButton"], "aria-label": t("authHelp"), children: "?" }) });
    const keylessNativeAuth = nativeAuth?.env.length === 0 && nativeAuth.oauth;
    const keyPlaceholder = keyHint === void 0 || props.credentialRequired === true ? t("keyPlaceholder") : t("keyPlaceholderFallback").replace("{hint}", () => keyHint);
    const catalogProps = {
      models,
      overridden: modelsOverridden,
      t,
      disabled,
      onChange: (next) => {
        setDraft((current2) => schema.setPath(current2, ["models"], next));
      },
      onReset: () => {
        setDraft((current2) => schema.deletePath(current2, ["models"]));
      }
    };
    return /* @__PURE__ */ jsxs16(Fragment5, { children: [
      keylessNativeAuth ? null : /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["field"], children: [
        /* @__PURE__ */ jsxs16("span", { className: ModelsSection_default["fieldLabel"], children: [
          t("keyInput"),
          authHelp
        ] }),
        /* @__PURE__ */ jsx19(
          ApiKeyInput,
          {
            t,
            value: keyText,
            ...keyDraft === void 0 && savedCredential ? {
              saved: {
                masked: detected[1].masked ?? "",
                ...detected[1].writable ? { clear: () => {
                  setKeyDraft({ ref: detected[0] });
                  setFailure(void 0);
                } } : {}
              }
            } : {},
            placeholder: keyPlaceholder,
            "aria-label": t("keyInput"),
            "aria-invalid": shownKeyFailure !== void 0 && !protocolKeyMissing,
            "aria-describedby": credentialHint === void 0 ? void 0 : `${props.provider}-credential-hint`,
            required: props.credentialRequired === true || protocolNeedsKeyHere,
            autoFocus: props.autoFocusCredential === true,
            disabled: disabled || keyRemoval?.removed === true,
            onChange: (event) => {
              setKeyDraft(event.target.value === "" && savedCredential ? detected[1].writable ? { ref: detected[0] } : void 0 : event.target.value);
              setFailure(void 0);
            }
          }
        ),
        credentialHint === void 0 ? null : /* @__PURE__ */ jsx19("p", { id: `${props.provider}-credential-hint`, className: ModelsSection_default[keyRemoval !== void 0 || missingRefs ? "notice" : keyText.length > 0 || detectedRef === void 0 ? "advancedHint" : "savedNotice"], children: credentialHint }),
        shownKeyFailure === void 0 ? null : /* @__PURE__ */ jsx19("p", { className: ModelsSection_default[protocolKeyMissing ? "advancedHint" : "error"], children: t(shownKeyFailure) })
      ] }),
      props.credentialOnly === true ? null : /* @__PURE__ */ jsxs16(
        "details",
        {
          className: ModelsSection_default["customized"],
          onToggle: (event) => {
            setCustomizedOpen(event.currentTarget.open);
          },
          children: [
            /* @__PURE__ */ jsx19("summary", { className: ModelsSection_default["customizedSummary"], children: t("customized") }),
            /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["customizedBody"], children: [
              ownsIdentity ? /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["field"], children: [
                /* @__PURE__ */ jsx19("span", { className: ModelsSection_default["fieldLabel"], children: t("customDisplayName") }),
                /* @__PURE__ */ jsx19(
                  "input",
                  {
                    className: ModelsSection_default["input"],
                    type: "text",
                    value: stringAt(draft, "displayName") ?? "",
                    placeholder: stringAt(schema.getPath(namespace.base, settingsPath), "displayName") ?? props.provider,
                    "aria-label": t("customDisplayName"),
                    disabled,
                    onChange: (event) => {
                      setField("displayName", event.target.value);
                    }
                  }
                )
              ] }) : null,
              /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["field"], children: [
                /* @__PURE__ */ jsx19("span", { className: ModelsSection_default["fieldLabel"], children: t("baseUrl") }),
                /* @__PURE__ */ jsx19(
                  "input",
                  {
                    className: ModelsSection_default["input"],
                    type: "text",
                    value: stringAt(draft, "baseURL") ?? "",
                    placeholder: family === "deepseek" ? t("deepSeekBaseUrl") : baseURL === void 0 ? t(endpointEnv.length > 0 ? "baseUrlConfigured" : "baseUrlDefault") : t("baseUrlPlaceholder").replace("{url}", () => baseURL),
                    "aria-describedby": endpointHint === void 0 ? void 0 : `${props.provider}-endpoint-hint`,
                    "aria-label": t("baseUrl"),
                    disabled,
                    onChange: (event) => {
                      setField("baseURL", event.target.value === "" ? void 0 : event.target.value);
                    }
                  }
                ),
                endpointHint === void 0 ? null : /* @__PURE__ */ jsx19("span", { id: `${props.provider}-endpoint-hint`, className: ModelsSection_default["advancedHint"], children: endpointHint })
              ] }),
              ownsIdentity ? /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["field"], children: [
                /* @__PURE__ */ jsx19("span", { className: ModelsSection_default["fieldLabel"], children: t("customApi") }),
                /* @__PURE__ */ jsxs16(
                  "select",
                  {
                    className: `${ModelsSection_default["input"]} ${ModelsSection_default["selectInput"]}`,
                    value: probeApi ?? "",
                    "aria-label": t("customApi"),
                    disabled,
                    onChange: (event) => {
                      setField("api", event.target.value);
                    },
                    children: [
                      probeApi === void 0 ? /* @__PURE__ */ jsx19("option", { value: "", children: t("customApiUnset") }) : null,
                      protocols.map((choice) => /* @__PURE__ */ jsx19("option", { value: choice, children: protocolLabel(t, choice) }, choice))
                    ]
                  }
                )
              ] }) : null,
              retryDefaults === void 0 ? null : /* @__PURE__ */ jsx19(
                RetryPolicyEditor,
                {
                  policy: schema.getPath(draft, ["retryPolicy"]),
                  defaults: retryDefaults,
                  failure: retryFailure,
                  failureId: `${props.provider}-retry-failure`,
                  showFailure: customizedOpen,
                  t,
                  disabled,
                  onChange: (next) => {
                    setDraft((current2) => next === void 0 ? schema.deletePath(current2, ["retryPolicy"]) : schema.setPath(current2, ["retryPolicy"], next));
                  }
                }
              ),
              family === "deepseek" ? /* @__PURE__ */ jsx19(
                DeepSeekModelsEditor,
                {
                  ...catalogProps,
                  defaultContextWindow: typeof defaultContextWindow === "number" ? defaultContextWindow : void 0,
                  defaultMaxTokens: typeof defaultMaxTokens === "number" ? defaultMaxTokens : void 0
                }
              ) : /* @__PURE__ */ jsx19(
                ModelListEditor,
                {
                  ...catalogProps,
                  catalogProvider: props.declared === true ? void 0 : props.provider,
                  reasoningLevels: reasoning.levels,
                  reasoningLevelsOnly: reasoning.levelsOnly,
                  defaultInput: Array.isArray(defaultInput) ? defaultInput : void 0,
                  probe,
                  probeBlocked: keyRemoval !== void 0 ? "keyRemovePending" : shownKeyFailure,
                  operations,
                  onBusyChange: setListBusy
                }
              )
            ] })
          ]
        }
      )
    ] });
  };
  return /* @__PURE__ */ jsxs16("div", { className: props.credentialOnly === true ? ModelsSection_default["addBlock"] : ModelsSection_default["editor"], children: [
    props.hideTitle === true ? null : /* @__PURE__ */ jsxs16("div", { className: ModelsSection_default["editorHeader"], children: [
      /* @__PURE__ */ jsx19("span", { className: ModelsSection_default["editorTitle"], children: props.displayName }),
      props.provider !== props.displayName ? /* @__PURE__ */ jsx19("span", { className: ModelsSection_default["editorRoute"], children: props.provider }) : null
    ] }),
    layout === "unknown" ? /* @__PURE__ */ jsx19("p", { className: ModelsSection_default["advancedHint"], children: `${t("advancedHint")} (${namespace.ns})` }) : curatedFields(layout),
    failure !== void 0 ? /* @__PURE__ */ jsx19("p", { className: ModelsSection_default["error"], children: failure }) : null,
    props.credentialOnly === true || modelFailure === void 0 ? null : /* @__PURE__ */ jsx19("p", { className: ModelsSection_default["advancedHint"], children: `${t("model")} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}` }),
    retryFailure === void 0 || customizedOpen ? null : /* @__PURE__ */ jsx19("p", { id: `${props.provider}-retry-failure`, className: ModelsSection_default["error"], children: retryFailure.message }),
    /* @__PURE__ */ jsx19(
      EditorFooter,
      {
        t,
        busy,
        submitDisabled: disabled || layout === "unknown" || props.credentialOnly !== true && modelFailure !== void 0 || retryFailure !== void 0 || shownKeyFailure !== void 0 || props.credentialRequired === true && keyValue.length === 0,
        submitLabelKey: props.submitLabelKey ?? "apply",
        submitBusyLabelKey: props.submitBusyLabelKey ?? "applying",
        cancelLabelKey: keyRemoval?.removed === true ? "close" : props.cancelLabelKey ?? "cancel",
        onCancel: () => {
          props.onClose(false);
        },
        onSubmit: () => {
          props.onSubmitCredential?.();
          void apply();
        }
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/ModelsSection.tsx
import { Fragment as Fragment6, jsx as jsx20, jsxs as jsxs17 } from "react/jsx-runtime";
function renderProviderEditor({ target, row, ...props }) {
  return /* @__PURE__ */ jsx20(
    ProviderEditor,
    {
      provider: target.provider,
      displayName: target.displayName,
      settingsPath: target.settingsPath,
      ...target.declared === true ? { declared: true } : {},
      ...target.defaultBaseURL === void 0 ? {} : { defaultBaseURL: target.defaultBaseURL },
      ...target.baseURLEnv === void 0 ? {} : { baseURLEnv: target.baseURLEnv },
      ...target.nativeAuth === void 0 ? {} : { nativeAuth: target.nativeAuth },
      ...row.credential === void 0 ? {} : { credential: row.credential },
      ...row.credentialChecks === void 0 ? {} : { credentialChecks: row.credentialChecks },
      ...props
    }
  );
}
async function removeProviderProfile(operations, controller, target) {
  if (target.credentialRef !== void 0) {
    const credential = await operations.removeCredential(target.credentialRef);
    if (credential !== void 0) return credential;
  }
  const written = await operations.writeSettings(
    target.settingsNs,
    [{ op: "unset", path: [...target.settingsPath] }],
    void 0
  );
  if (written.kind !== "written") return written.message;
  await controller.load();
  return void 0;
}
function needsSetup(row, anyUsable) {
  if (anyUsable || row.entry.provider === "deepseek-account") return false;
  if (row.entry.settingsPath.length > 0) return false;
  return row.credential?.configured !== true;
}
function keyConfiguredOf(row) {
  return row.apiKeyEnv !== void 0 ? row.credential?.configured === true : row.derivedCredential?.configured === true;
}
function targetOf(row) {
  const managedRef = deriveKeyRef(row.entry.provider);
  const credentialRef = row.apiKeyEnv === managedRef && row.credential?.configured === true && row.credential.writable ? managedRef : void 0;
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === void 0 ? {} : { credentialRef },
    // Only declared routes may expose route-owned fields.
    ...row.entry.declared === true ? { declared: true } : {},
    ...row.entry.defaultBaseURL === void 0 ? {} : { defaultBaseURL: row.entry.defaultBaseURL },
    ...row.entry.baseURLEnv === void 0 ? {} : { baseURLEnv: row.entry.baseURLEnv },
    ...row.entry.nativeAuth === void 0 ? {} : { nativeAuth: row.entry.nativeAuth }
  };
}
function providerTargetLabel(target) {
  return target.provider === target.displayName ? target.provider : `${target.displayName} (${target.provider})`;
}
function providerCopy(template, target) {
  return template.replace("{provider}", () => providerTargetLabel(target));
}
function ModelsSection(props) {
  const { controller, useSnapshot, operations, schema, t, renderSlot } = props;
  if (controller === void 0 || useSnapshot === void 0 || operations === void 0 || schema === void 0 || t === void 0) return null;
  return /* @__PURE__ */ jsx20(Loaded, { injected: { controller, useSnapshot, operations, schema, t }, renderSlot });
}
function Loaded({ injected, renderSlot }) {
  const { controller, operations, schema, t } = injected;
  const snapshot2 = injected.useSnapshot((value) => value);
  const state = { ...snapshot2, rows: snapshot2.rows.map((row) => row.entry.provider === "deepseek-account" ? { ...row, entry: { ...row.entry, displayName: t("deepSeekAccount") } } : row) };
  const [hasReadySnapshot, setHasReadySnapshot] = useState9(state.status === "ready");
  if (state.status === "ready" && !hasReadySnapshot) setHasReadySnapshot(true);
  if (state.status === "error" && hasReadySnapshot) setHasReadySnapshot(false);
  const [editing, setEditing] = useState9(void 0);
  const [addOpen, setAddOpen] = useState9(false);
  const [addMode, setAddMode] = useState9("catalog");
  const [visited, setVisited] = useState9(() => /* @__PURE__ */ new Set());
  const [catalogBusy, setCatalogBusy] = useState9(false);
  const [customBusy, setCustomBusy] = useState9(false);
  const addId = useId2();
  const [deleteTarget, setDeleteTarget] = useState9(void 0);
  const [deleting, setDeleting] = useState9(false);
  const [deleteFailure, setDeleteFailure] = useState9(void 0);
  const [savedTarget, setSavedTarget] = useState9(void 0);
  const [dismissedSetup, setDismissedSetup] = useState9(() => /* @__PURE__ */ new Set());
  const announceSaved = (target) => {
    void controller.load().then(() => {
      setSavedTarget(target);
    });
  };
  const closeAdd = () => {
    setEditing(void 0);
    setAddOpen(false);
    setCatalogBusy(false);
    setCustomBusy(false);
  };
  const closeEditor = (changed, target) => {
    closeAdd();
    if (changed) announceSaved(target);
  };
  const closeSetup = (changed, target) => {
    setDismissedSetup((previous) => /* @__PURE__ */ new Set([...previous, target.provider]));
    if (changed) announceSaved(target);
  };
  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(void 0);
    setDeleteFailure(void 0);
  };
  const confirmDelete = () => {
    if (deleteTarget === void 0 || deleting) return;
    setDeleting(true);
    setDeleteFailure(void 0);
    void removeProviderProfile(operations, controller, deleteTarget).then((failure) => {
      if (failure !== void 0) {
        setDeleteFailure(failure);
        return;
      }
      setDeleteTarget(void 0);
    }).finally(() => {
      setDeleting(false);
    });
  };
  if (state.status === "idle") void controller.load();
  if (state.status === "error") {
    const errorText = state.error ?? "";
    return /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["section"], children: [
      /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["error"], children: `${t("loadFailed")}: ${errorText}` }),
      /* @__PURE__ */ jsx20("button", { type: "button", className: ModelsSection_default["secondaryButton"], onClick: () => {
        void controller.load();
      }, children: t("retry") })
    ] });
  }
  if (!hasReadySnapshot && state.status !== "ready") {
    return /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["section"], children: [
      /* @__PURE__ */ jsx20("h2", { className: ModelsSection_default["title"], children: t("title") }),
      /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["intro"], children: t("intro") })
    ] });
  }
  const savedRow = savedTarget === void 0 ? void 0 : state.rows.find((row) => row.entry.provider === savedTarget.provider);
  const savedIdentity = savedRow === void 0 ? savedTarget : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName };
  const anyUsable = state.rows.some(providerUsable);
  const configured = state.rows.filter((row) => row.configured);
  const configurable = state.rows.filter((row) => state.namespaces.has(row.entry.settingsNs));
  const addable = state.rows.flatMap((row) => {
    const namespace = state.namespaces.get(row.entry.settingsNs);
    return namespace === void 0 || row.configured ? [] : [{ row, namespace }];
  });
  const piAi = state.namespaces.get("llm-pi-ai");
  const protocols = protocolChoices(piAi, schema);
  const reasoningLevels = reasoningLevelChoices(piAi, schema);
  const catalogOffered = configurable.length > 0;
  const catalogEnabled = addable.length > 0;
  const customOffered = piAi !== void 0;
  const customEnabled = protocols.length > 0;
  const bothOffered = catalogOffered && customOffered;
  const mode = bothOffered ? addMode : customOffered ? "custom" : "catalog";
  const mounted = (candidate) => mode === candidate || visited.has(candidate);
  const switchLocked = catalogBusy || customBusy;
  const draft = (() => {
    if (!addOpen || !catalogOffered) return void 0;
    const kept = editing === void 0 ? void 0 : state.namespaces.get(editing.settingsNs);
    if (editing !== void 0 && kept !== void 0) return { target: editing, namespace: kept };
    const first = addable[0];
    return first === void 0 ? void 0 : { target: targetOf(first.row), namespace: first.namespace };
  })();
  const addRow = draft === void 0 ? void 0 : state.rows.find((row) => row.entry.provider === draft.target.provider);
  return /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["section"], children: [
    /* @__PURE__ */ jsx20("h2", { className: ModelsSection_default["title"], children: t("title") }),
    /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["intro"], children: t("intro") }),
    !state.writable && state.status === "ready" ? /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["notice"], children: t("readOnly") }) : null,
    savedIdentity === void 0 ? null : /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["savedNotice"], role: "status", "aria-live": "polite", children: providerCopy(t("savedProvider"), savedIdentity) }),
    /* @__PURE__ */ jsx20("ul", { className: ModelsSection_default["rows"], children: configured.map((row) => {
      const target = targetOf(row);
      const namespace = state.namespaces.get(target.settingsNs);
      if (namespace === void 0) return null;
      const error = row.entry.error === void 0 ? null : /* @__PURE__ */ jsx20("p", { role: "alert", className: ModelsSection_default["error"], children: row.entry.error });
      if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
        return /* @__PURE__ */ jsxs17("li", { className: ModelsSection_default["setupCard"], children: [
          error,
          renderProviderEditor({
            target,
            row,
            namespace,
            schema,
            operations,
            t,
            readOnly: !state.writable,
            onClose: (changed) => {
              closeSetup(changed, target);
            }
          }),
          renderSlot(
            "settings.models.provider-card",
            { provider: row.entry, configured: row.configured, keyConfigured: keyConfiguredOf(row) },
            { entryKey: row.entry.settingsNs }
          )
        ] }, row.entry.provider);
      }
      const open = !addOpen && editing?.provider === row.entry.provider;
      const credentialConfigured = row.credential?.configured === true;
      const credentialMissing = !credentialConfigured && row.apiKeyEnv !== void 0 && row.credential?.configured === false;
      return /* @__PURE__ */ jsxs17("li", { className: ModelsSection_default["rowCard"], children: [
        /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["rowHead"], children: [
          /* @__PURE__ */ jsxs17("span", { className: ModelsSection_default["rowIdentity"], children: [
            /* @__PURE__ */ jsx20("span", { className: ModelsSection_default["rowName"], children: row.entry.displayName }),
            row.entry.declared === true ? /* @__PURE__ */ jsx20("span", { className: ModelsSection_default["rowTag"], children: t("customTag") }) : null,
            row.entry.provider === "deepseek-account" ? /* @__PURE__ */ jsxs17("span", { className: ModelsSection_default["accountStatus"], children: [
              /* @__PURE__ */ jsx20("span", { className: `${ModelsSection_default["credentialDot"]} ${ModelsSection_default["credentialDotConfigured"]}`, "aria-hidden": "true" }),
              t("accountSignedIn")
            ] }) : null,
            credentialConfigured ? /* @__PURE__ */ jsx20(
              "span",
              {
                className: `${ModelsSection_default["credentialDot"]} ${ModelsSection_default["credentialDotConfigured"]}`,
                role: "img",
                "aria-label": t("credentialConfigured"),
                title: t("credentialConfigured")
              }
            ) : credentialMissing ? /* @__PURE__ */ jsx20(
              "span",
              {
                className: `${ModelsSection_default["credentialDot"]} ${ModelsSection_default["credentialDotMissing"]}`,
                role: "img",
                "aria-label": t("credentialMissing"),
                title: t("credentialMissing")
              }
            ) : null
          ] }),
          /* @__PURE__ */ jsxs17("span", { className: ModelsSection_default["rowActions"], children: [
            row.entry.provider === "deepseek-account" ? null : /* @__PURE__ */ jsx20(
              "button",
              {
                type: "button",
                className: ModelsSection_default["secondaryButton"],
                "aria-label": providerCopy(t("editProvider"), target),
                disabled: !open && state.status !== "ready",
                onClick: () => {
                  if (!open && controller.store.getSnapshot().status !== "ready") return;
                  setSavedTarget(void 0);
                  setAddOpen(false);
                  setEditing(open ? void 0 : target);
                },
                children: t("edit")
              }
            ),
            row.removable ? /* @__PURE__ */ jsx20(
              "button",
              {
                type: "button",
                className: ModelsSection_default["dangerButton"],
                "aria-label": providerCopy(t("removeProvider"), target),
                disabled: !state.writable || state.status !== "ready",
                onClick: () => {
                  if (controller.store.getSnapshot().status !== "ready") return;
                  setSavedTarget(void 0);
                  setDeleteFailure(void 0);
                  setDeleteTarget(target);
                },
                children: t("remove")
              }
            ) : null
          ] })
        ] }),
        error,
        renderSlot(
          "settings.models.provider-card",
          { provider: row.entry, configured: row.configured, keyConfigured: keyConfiguredOf(row) },
          { entryKey: row.entry.settingsNs }
        ),
        open ? renderProviderEditor({
          target,
          row,
          namespace,
          schema,
          operations,
          t,
          readOnly: !state.writable,
          onClose: (changed) => {
            closeEditor(changed, target);
          }
        }) : null
      ] }, row.entry.provider);
    }) }),
    /* @__PURE__ */ jsx20("div", { className: ModelsSection_default["addBlock"], children: addOpen ? /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["addCard"], children: [
      /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["addModes"], children: [
        bothOffered ? /* @__PURE__ */ jsx20(
          SegmentedControl,
          {
            id: addId,
            label: t("addMode"),
            value: mode,
            disabled: switchLocked,
            options: [
              {
                value: "catalog",
                label: t("addCatalog"),
                disabled: !catalogEnabled,
                ...catalogEnabled ? {} : { title: t("addCatalogExhausted") }
              },
              {
                value: "custom",
                label: t("addCustom"),
                disabled: !customEnabled,
                ...customEnabled ? {} : { title: t("addCustomUnavailable") }
              }
            ],
            onChange: (next) => {
              setAddMode(next);
              setVisited((previous) => /* @__PURE__ */ new Set([...previous, next]));
            }
          }
        ) : (
          // One mode alone has no switch to name it, so the card
          // carries the mode as its title instead.
          /* @__PURE__ */ jsx20("div", { className: ModelsSection_default["editorHeader"], children: /* @__PURE__ */ jsx20("span", { className: ModelsSection_default["editorTitle"], children: t(mode === "catalog" ? "addCatalog" : "addCustom") }) })
        ),
        /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["advancedHint"], children: t(mode === "catalog" ? "addCatalogHint" : "addCustomHint") })
      ] }),
      mounted("catalog") && draft !== void 0 ? /* @__PURE__ */ jsxs17(
        "div",
        {
          id: `${addId}-catalog-panel`,
          ...bothOffered ? { role: "tabpanel", "aria-labelledby": `${addId}-catalog` } : {},
          hidden: mode !== "catalog",
          className: ModelsSection_default["addPanel"],
          children: [
            /* @__PURE__ */ jsxs17("div", { className: ModelsSection_default["field"], children: [
              /* @__PURE__ */ jsx20("span", { className: ModelsSection_default["fieldLabel"], children: t("provider") }),
              /* @__PURE__ */ jsx20(
                "select",
                {
                  className: `${ModelsSection_default["input"]} ${ModelsSection_default["selectInput"]}`,
                  value: draft.target.provider,
                  "aria-label": t("provider"),
                  disabled: catalogBusy,
                  onChange: (event) => {
                    const picked = addable.find((candidate) => candidate.row.entry.provider === event.target.value);
                    if (picked === void 0) return;
                    setEditing(targetOf(picked.row));
                  },
                  children: addable.map(({ row }) => /* @__PURE__ */ jsx20("option", { value: row.entry.provider, children: row.entry.displayName }, row.entry.provider))
                }
              )
            ] }),
            /* @__PURE__ */ jsx20(
              ProviderEditor,
              {
                provider: draft.target.provider,
                displayName: draft.target.displayName,
                hideTitle: true,
                namespace: draft.namespace,
                schema,
                settingsPath: draft.target.settingsPath,
                operations,
                ...draft.target.defaultBaseURL === void 0 ? {} : { defaultBaseURL: draft.target.defaultBaseURL },
                ...draft.target.baseURLEnv === void 0 ? {} : { baseURLEnv: draft.target.baseURLEnv },
                ...draft.target.nativeAuth === void 0 ? {} : { nativeAuth: draft.target.nativeAuth },
                ...addRow?.credentialChecks === void 0 ? {} : { credentialChecks: addRow.credentialChecks },
                t,
                readOnly: !state.writable,
                onClose: (changed) => {
                  closeEditor(changed, draft.target);
                },
                onBusyChange: setCatalogBusy
              },
              draft.target.provider
            ),
            addRow === void 0 ? null : renderSlot(
              "settings.models.provider-card",
              { provider: addRow.entry, configured: addRow.configured, keyConfigured: keyConfiguredOf(addRow) },
              { entryKey: addRow.entry.settingsNs }
            )
          ]
        }
      ) : null,
      mounted("custom") && piAi !== void 0 ? /* @__PURE__ */ jsx20(
        "div",
        {
          id: `${addId}-custom-panel`,
          ...bothOffered ? { role: "tabpanel", "aria-labelledby": `${addId}-custom` } : {},
          hidden: mode !== "custom",
          className: ModelsSection_default["addPanel"],
          children: /* @__PURE__ */ jsx20(
            CustomProviderCard,
            {
              taken: state.rows.map((row) => row.entry.provider),
              protocols,
              reasoningLevels,
              revision: piAi.revision,
              operations,
              t,
              readOnly: !state.writable,
              onClose: (changed) => {
                closeAdd();
                if (changed) void controller.load();
              },
              onBusyChange: setCustomBusy
            }
          )
        }
      ) : null
    ] }) : catalogOffered || customOffered ? (
      // One entry for both ways to gain a provider; the card behind it
      // splits them. Full width, so it lines up with the rows above.
      /* @__PURE__ */ jsx20("div", { className: ModelsSection_default["addActions"], children: /* @__PURE__ */ jsxs17(
        "button",
        {
          type: "button",
          className: ModelsSection_default["addButton"],
          disabled: !state.writable || state.status !== "ready" || !catalogEnabled && !customEnabled,
          onClick: () => {
            if (controller.store.getSnapshot().status !== "ready") return;
            const first = addable[0];
            const initial = catalogEnabled ? "catalog" : "custom";
            setSavedTarget(void 0);
            setEditing(first === void 0 ? void 0 : targetOf(first.row));
            setAddMode(initial);
            setVisited(/* @__PURE__ */ new Set([initial]));
            setAddOpen(true);
          },
          children: [
            /* @__PURE__ */ jsx20(IconPlusOutlineRegular, { size: 14 }),
            t("add")
          ]
        }
      ) })
    ) : null }),
    renderSlot("settings.models.footer", {}),
    /* @__PURE__ */ jsx20(
      Modal,
      {
        open: deleteTarget !== void 0,
        onClose: closeDelete,
        title: deleteTarget === void 0 ? "" : providerCopy(t("deleteTitle"), deleteTarget),
        closeLabel: t("close"),
        description: deleteTarget === void 0 ? "" : providerCopy(
          deleteTarget.credentialRef === void 0 ? t("deleteDescription") : t("deleteDescriptionWithCredential"),
          deleteTarget
        ),
        className: ModelsSection_default["deleteDialog"],
        footer: /* @__PURE__ */ jsxs17(Fragment6, { children: [
          /* @__PURE__ */ jsx20(Button, { variant: "outline", "data-modal-autofocus": true, disabled: deleting, onClick: closeDelete, children: t("cancel") }),
          /* @__PURE__ */ jsx20(
            Button,
            {
              variant: "outline",
              className: ModelsSection_default["deleteConfirm"],
              disabled: deleting,
              onClick: confirmDelete,
              children: deleteTarget === void 0 ? "" : providerCopy(deleting ? t("deleting") : t("deleteConfirm"), deleteTarget)
            }
          )
        ] }),
        children: deleteFailure === void 0 ? null : /* @__PURE__ */ jsx20("p", { className: ModelsSection_default["error"], children: deleteFailure })
      }
    )
  ] });
}

// deepseek-harness/packages/client/ui-settings-models/src/client/operations.ts
function createModelsOperations(ctx) {
  return {
    storeCredential: async (ref, value) => {
      const response = await ctx.remote.credentials.set(ref, value);
      return response.ok ? void 0 : response.error.message;
    },
    removeCredential: async (ref) => {
      const response = await ctx.remote.credentials.unset(ref);
      return response.ok ? void 0 : response.error.message;
    },
    writeSettings: async (ns, ops, expectedRevision) => {
      const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision);
      if (response.ok) return { kind: "written", view: response.value };
      const { code, message } = response.error;
      return code === "settings/conflict" ? { kind: "conflict", message } : { kind: "refused", message };
    },
    discoverModels: async (settingsNs, request2) => {
      const response = await ctx.remote.llm.discoverModels(settingsNs, request2);
      return response.ok ? { kind: "found", models: response.value } : { kind: "refused", message: response.error.message };
    }
  };
}

// deepseek-harness/packages/client/ui-settings-models/src/client/schema-operations.ts
function createSettingsSchemaOperations(service) {
  return {
    rehydrate: (serialized) => service.rehydrate(serialized),
    validate: (schema, draft) => service.validate(schema, draft),
    nodeAtPath: (root, path) => service.nodeAtPath(root, path),
    getPath: (value, path) => service.getPath(value, path),
    hasPath: (value, path) => service.hasPath(value, path),
    setPath: (root, path, value) => service.setPath(root, path, value),
    deletePath: (root, path) => service.deletePath(root, path)
  };
}

// desktop/compat/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject2(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current2 = snapshot(value);
  return Object.freeze({
    get: () => current2,
    [write]: (value2) => {
      current2 = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is2(type, value) {
  if (arguments.length === 1) return (value2) => is2(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is2("ArrayBuffer", value) || is2("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is2("Date", source)) return new Date(source.valueOf());
  if (is2("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is2("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is2("URL"), (a3, b3) => a3.href === b3.href) ?? check(is2("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// desktop/compat/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set2(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current2 = schema;
    let fallback = schema.meta.default;
    while (current2?.type === "intersect" && isNullable(fallback)) {
      current2 = current2.list[0];
      fallback = current2?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject2(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject2(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject2(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, { [name](...args) {
    const schema = new Schema({ type: name });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name === "object" || name === "dict") schema.meta.default = {};
    else if (name === "array" || name === "tuple") schema.meta.default = [];
    else if (name === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// deepseek-harness/packages/client/ui-settings/src/client/schema.ts
function cloneContainer(container, key) {
  if (Array.isArray(container)) return [...container];
  if (typeof container === "object" && container !== null) return { ...container };
  return /^\d+$/.test(key) ? [] : {};
}
function cloneSpine(root, path) {
  const result = { ...root };
  let target = result;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index];
    const child = cloneContainer(
      Array.isArray(target) ? target[Number(key)] : target[key],
      path[index + 1]
    );
    if (Array.isArray(target)) target[Number(key)] = child;
    else target[key] = child;
    target = child;
  }
  return { result, parent: target, leaf: path[path.length - 1] };
}
var SettingsSchemaService = class {
  /** @param ctx - providing ui-settings context. */
  constructor(ctx) {
    void ctx;
  }
  /**
   * Rehydrate one serialized `schema.toJSON()` envelope.
   * @param serialized - serialized Schemastery node.
   * @returns live schema node.
   */
  rehydrate(serialized) {
    return new Schema(serialized);
  }
  /**
   * Validate a settings draft.
   * @param schema - live schema node.
   * @param draft - candidate settings value.
   * @returns validation failure text, or `undefined` when valid.
   */
  validate(schema, draft) {
    try {
      ;
      schema(draft);
      return void 0;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  /**
   * Resolve an object, dict, or array schema node at a settings path.
   * @param root - schema node to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved node, or `undefined` when the path is absent.
   */
  nodeAtPath(root, path) {
    let node = root;
    for (const key of path) {
      if (node === void 0) return void 0;
      if (node.type === "object") node = node.dict?.[key];
      else if (node.type === "dict" || node.type === "array") node = node.inner;
      else return void 0;
    }
    return node;
  }
  /**
   * Read a nested value by a string-key or array-index path.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns the resolved value, or `undefined` when the path is absent.
   */
  getPath(value, path) {
    let current2 = value;
    for (const key of path) {
      if (Array.isArray(current2)) {
        current2 = current2[Number(key)];
        continue;
      }
      if (typeof current2 !== "object" || current2 === null) return void 0;
      current2 = current2[key];
    }
    return current2;
  }
  /**
   * Report whether the final path key exists independently of its value.
   * @param value - value to traverse.
   * @param path - object keys or array indexes.
   * @returns whether the path exists.
   */
  hasPath(value, path) {
    if (path.length === 0) return value !== void 0;
    const parent = this.getPath(value, path.slice(0, -1));
    const key = path[path.length - 1];
    if (Array.isArray(parent)) return Number(key) < parent.length;
    if (typeof parent !== "object" || parent === null) return false;
    return key in parent;
  }
  /**
   * Immutably set a nested value, materializing missing containers.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @param value - replacement value.
   * @returns copied root containing the replacement.
   * @throws when `path` is empty.
   */
  setPath(root, path, value) {
    if (path.length === 0) throw new Error("ui-settings: setPath needs a non-empty path");
    const { result, parent, leaf } = cloneSpine(root, path);
    if (Array.isArray(parent)) parent[Number(leaf)] = value;
    else parent[leaf] = value;
    return result;
  }
  /**
   * Immutably remove a nested key, preserving an unchanged missing root.
   * @param root - settings object to copy.
   * @param path - non-empty object-key or array-index path.
   * @returns copied root without the key, or `root` when the path is absent.
   * @throws when `path` is empty.
   */
  deletePath(root, path) {
    if (path.length === 0) throw new Error("ui-settings: deletePath needs a non-empty path");
    if (!this.hasPath(root, path)) return root;
    const { result, parent, leaf } = cloneSpine(root, path);
    if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
    else Reflect.deleteProperty(parent, leaf);
    return result;
  }
};

// deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts
var SettingsDescribeMirror = class {
  /**
   * @param ctx - the providing plugin's context, whose `remote.settings`
   * namespace answers the describe read.
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.store = createSnapshotStore({
      status: "idle",
      view: void 0,
      error: null
    });
  }
  store;
  inFlight;
  rerun = false;
  generation = 0;
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot() {
    return this.store.getSnapshot();
  }
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener) {
    return this.store.subscribe(listener);
  }
  /**
   * Refresh from the Host. A call during an in-flight read marks one rerun
   * after it settles instead of racing a second wire read.
   * @returns settlement after this call's freshness is reflected.
   */
  load() {
    if (this.inFlight !== void 0) {
      this.rerun = true;
      return this.inFlight;
    }
    const run = Promise.resolve().then(() => this.run());
    this.inFlight = run;
    return run;
  }
  /**
   * Resolve once an answer is held, reading only from `idle`.
   * @returns settlement of the current or newly started read, if any.
   */
  ensure() {
    if (this.inFlight !== void 0) return this.inFlight;
    if (this.getSnapshot().status === "idle") return this.load();
    return Promise.resolve();
  }
  /**
   * Fold one write answer's namespace view into the held view without a wire
   * read, and invalidate any read still in flight. With no held document, the
   * answer is not published as a partial document; an in-flight read reruns so
   * it cannot publish a document fetched before the write committed.
   * @param view - the namespace view a settings write answered with.
   */
  acceptView(view) {
    const before = this.store.getSnapshot();
    this.generation += 1;
    if (this.inFlight !== void 0) this.rerun = true;
    if (before.view === void 0) return;
    const namespaces = before.view.namespaces.some((row) => row.ns === view.ns) ? before.view.namespaces.map((row) => row.ns === view.ns ? view : row) : [...before.view.namespaces, view];
    this.store.set({ ...before, view: { ...before.view, namespaces } });
  }
  /**
   * Convenience row lookup on the held view.
   * @param ns - namespace identity.
   * @returns the namespace view, or undefined while unanswered or unregistered.
   */
  namespace(ns) {
    return this.store.getSnapshot().view?.namespaces.find((row) => row.ns === ns);
  }
  async run() {
    try {
      do {
        const before = this.store.getSnapshot();
        if (before.status === "idle") this.store.set({ ...before, status: "loading" });
        this.rerun = false;
        const generation = ++this.generation;
        let outcome;
        try {
          const response = await this.ctx.remote.settings.describe();
          outcome = response.ok ? { view: response.value } : { failure: response.error.message };
        } catch (error) {
          outcome = { failure: error instanceof Error ? error.message : String(error) };
        }
        if (generation !== this.generation) continue;
        if ("view" in outcome) {
          this.store.set({ status: "ready", view: outcome.view, error: null });
        } else {
          const held = this.store.getSnapshot();
          this.store.set({
            status: held.view === void 0 ? "idle" : "ready",
            view: held.view,
            error: outcome.failure
          });
        }
      } while (this.shouldRerun());
    } finally {
      this.inFlight = void 0;
    }
  }
  shouldRerun() {
    return this.rerun;
  }
};

// deepseek-harness/packages/client/ui-settings-models/src/client/locales.ts
var zh = {
  nav: "\u6A21\u578B",
  deepSeekAccount: "DeepSeek \u8D26\u53F7",
  title: "\u6A21\u578B",
  intro: "\u586B\u5165\u5404\u63D0\u4F9B\u5546\u7684 API \u5BC6\u94A5\u5373\u53EF\u4F7F\u7528\u5176\u6A21\u578B\u3002",
  edit: "\u7F16\u8F91",
  editProvider: "\u7F16\u8F91 {provider}",
  remove: "\u5220\u9664",
  removeProvider: "\u5220\u9664 {provider}",
  deleteTitle: "\u5220\u9664 {provider}\uFF1F",
  deleteDescription: "\u5220\u9664 {provider} \u4F1A\u79FB\u9664\u5176\u914D\u7F6E\uFF1B\u5176\u4F7F\u7528\u7684\u51ED\u8BC1\uFF08\u5982\u6709\uFF09\u7531\u5176\u4ED6\u4F4D\u7F6E\u7BA1\u7406\uFF0C\u5C06\u4F1A\u4FDD\u7559\u3002",
  deleteDescriptionWithCredential: "\u5220\u9664 {provider} \u4F1A\u79FB\u9664\u5176\u914D\u7F6E\u548C\u5B58\u50A8\u7684 API \u5BC6\u94A5\u3002",
  deleteConfirm: "\u5220\u9664 {provider}",
  deleting: "\u6B63\u5728\u5220\u9664 {provider}\u2026",
  add: "\u6DFB\u52A0\u6A21\u578B\u63D0\u4F9B\u5546",
  addMode: "\u6DFB\u52A0\u65B9\u5F0F",
  addCatalog: "\u7B2C\u4E09\u65B9\u6A21\u578B\u63D0\u4F9B\u5546",
  addCustom: "\u81EA\u5B9A\u4E49\u6A21\u578B API",
  addCatalogHint: "\u4ECE\u5185\u7F6E\u76EE\u5F55\u4E2D\u9009\u62E9 OpenAI\u3001Anthropic\u3001Kimi \u7B49\u63D0\u4F9B\u5546\uFF0C\u586B\u5165\u5176 API \u5BC6\u94A5\u5373\u53EF\u4F7F\u7528\u3002",
  addCustomHint: "\u8FDE\u63A5\u4E2D\u8F6C\u7AD9\u3001\u81EA\u90E8\u7F72\u670D\u52A1\u6216\u5176\u4ED6\u517C\u5BB9 OpenAI / Anthropic / Gemini \u534F\u8BAE\u7684\u63A5\u53E3\uFF0C\u9700\u586B\u5199 API \u5730\u5740\u3001\u534F\u8BAE\u548C\u6A21\u578B\u3002",
  addCatalogExhausted: "\u76EE\u5F55\u4E2D\u7684\u63D0\u4F9B\u5546\u90FD\u5DF2\u6DFB\u52A0\u3002",
  addCustomUnavailable: "\u6CA1\u6709\u53EF\u7528\u7684 API \u534F\u8BAE\u3002",
  provider: "\u63D0\u4F9B\u5546",
  close: "\u5173\u95ED",
  cancel: "\u53D6\u6D88",
  apply: "\u4FDD\u5B58",
  applying: "\u4FDD\u5B58\u4E2D\u2026",
  savedProvider: "\u5DF2\u4FDD\u5B58 {provider}\u3002",
  credentialConfigured: "API \u5BC6\u94A5\u5DF2\u914D\u7F6E",
  credentialMissing: "API \u5BC6\u94A5\u7F3A\u5931",
  accountSignedIn: "\u5DF2\u767B\u5F55",
  readOnly: "\u5F53\u524D\u90E8\u7F72\u7684\u8BBE\u7F6E\u6587\u6863\u4E3A\u53EA\u8BFB\u3002",
  loadFailed: "\u52A0\u8F7D\u63D0\u4F9B\u5546\u76EE\u5F55\u5931\u8D25",
  conflict: "\u8FD9\u5F20\u5361\u7247\u6253\u5F00\u671F\u95F4\uFF0C\u8FD9\u4E9B\u8BBE\u7F6E\u5DF2\u88AB\u5176\u4ED6\u5730\u65B9\u6539\u52A8\u3002\u8BF7\u5173\u95ED\u540E\u91CD\u65B0\u6253\u5F00\uFF0C\u5728\u5F53\u524D\u503C\u4E0A\u7F16\u8F91\u3002",
  retry: "\u91CD\u8BD5",
  keyInput: "API \u5BC6\u94A5",
  keyReveal: "\u663E\u793A\u5BC6\u94A5",
  keyHide: "\u9690\u85CF\u5BC6\u94A5",
  keyPlaceholder: "\u8F93\u5165 API \u5BC6\u94A5",
  keyPlaceholderFallback: "\u7559\u7A7A\u4F7F\u7528\u73AF\u5883\u8BA4\u8BC1\uFF08{hint}\uFF09",
  keySaved: "\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684 API key\u3002",
  keyReplacePending: "\u4FDD\u5B58\u4EE5\u66FF\u6362\u5DF2\u4FDD\u5B58\u7684 API key\u3002",
  keyRemovePending: "\u4FDD\u5B58\u4EE5\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684 API key\uFF0C\u5E76\u6539\u7528\u73AF\u5883\u8BA4\u8BC1\u3002",
  keyRemovePendingEnvironment: "\u4FDD\u5B58\u4EE5\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684 API key\u3002\u4E4B\u540E\u4F7F\u7528\u73AF\u5883\u8BA4\u8BC1\uFF08{hint}\uFF09\u3002",
  keyRemoveApplied: "\u5BC6\u94A5\u5DF2\u6E05\u9664\uFF0C\u8BF7\u91CD\u8BD5\u4FDD\u5B58\u4EE5\u5B8C\u6210\u914D\u7F6E\u66F4\u65B0\uFF1B\u6B64\u5220\u9664\u65E0\u6CD5\u64A4\u9500",
  keyFallbackMissing: "\u672A\u68C0\u6D4B\u5230\u73AF\u5883\u53D8\u91CF\u3002\u8BF7\u586B\u5199 API \u5BC6\u94A5\uFF0C\u6216\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF {hint}\u3002",
  keyFallbackDetected: "\u5DF2\u68C0\u6D4B\u5230\u73AF\u5883\u53D8\u91CF\uFF08{hint}\uFF09",
  keyFallbackDetectedHidden: "\u5DF2\u68C0\u6D4B\u5230\u73AF\u5883\u53D8\u91CF",
  keyFallbackUnchecked: "\u73AF\u5883\u51ED\u636E\u72B6\u6001\u5C1A\u672A\u786E\u8BA4",
  keyHelp: "\u4F18\u5148\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684\u51ED\u636E\u3002\u6B64\u5904\u663E\u793A\u7684\u73AF\u5883\u540E\u5907\u6309\u4EE5\u4E0B\u987A\u5E8F\u6392\u5217\uFF1A{env}\u3002\u6765\u6E90\u4F9D\u6B21\u4E3A\u542F\u52A8\u73AF\u5883\u3001$cwd/.env\u3001$DSH_HOME/.env\u3002",
  authHelp: "\u8BA4\u8BC1\u8BF4\u660E",
  customized: "\u81EA\u5B9A\u4E49\u8BBE\u7F6E",
  baseUrl: "API \u5730\u5740",
  baseUrlDefault: "\u6CA1\u6709\u9ED8\u8BA4\u5730\u5740",
  baseUrlEnvironment: "\u63D0\u4F9B\u65B9\u5730\u5740\u914D\u7F6E\uFF1A{env}",
  baseUrlConfigured: "\u7531\u63D0\u4F9B\u65B9\u914D\u7F6E\u5730\u5740",
  baseUrlPlaceholder: "{url}",
  deepSeekBaseUrl: "https://api.deepseek.com/anthropic\uFF08\u9ED8\u8BA4\u4F7F\u7528\u73AF\u5883 DEEPSEEK_BASE_URL\uFF09",
  deepSeekEndpointHint: "\u8BF7\u586B\u5199\u517C\u5BB9 Anthropic Messages \u534F\u8BAE\u7684 API \u5730\u5740\u3002",
  retryPolicy: "\u91CD\u8BD5\u7B56\u7565",
  retryModeDefault: "\u9ED8\u8BA4\uFF08{mode}\uFF09",
  retryModeNormal: "\u4EC5\u4E34\u65F6\u9519\u8BEF",
  retryModeAlways: "\u6240\u6709\u9519\u8BEF",
  retryAlwaysHint: "\u5931\u8D25\u7684\u8BF7\u6C42\u4F1A\u6301\u7EED\u91CD\u8BD5\uFF0C\u76F4\u5230\u6210\u529F\u6216\u672C\u8F6E\u88AB\u505C\u6B62\u3002",
  retryMaxRetries: "\u6700\u5927\u91CD\u8BD5\u6B21\u6570",
  retryCodes: "\u9519\u8BEF\u7801",
  retryCodeEmptyResponse: "\u7A7A\u54CD\u5E94",
  retryCodeRateLimit: "\u8BF7\u6C42\u9650\u6D41",
  retryCodeServer: "\u670D\u52A1\u5668\u9519\u8BEF",
  retryCodeTimeout: "\u8D85\u65F6",
  retryCodeTransport: "\u7F51\u7EDC\u9519\u8BEF",
  retryCodeStreamClosed: "\u6D41\u63D0\u524D\u7ED3\u675F",
  retryCodeMalformedResponse: "\u54CD\u5E94\u683C\u5F0F\u9519\u8BEF",
  retryCodeQuota: "\u914D\u989D\u5DF2\u7528\u5C3D",
  retryCodeCustom: "\u81EA\u5B9A\u4E49\u9519\u8BEF\u7801",
  retryCodeAdd: "\u6DFB\u52A0",
  retryInitialDelay: "\u521D\u59CB\u5EF6\u8FDF (ms)",
  retryMaxDelay: "\u6700\u5927\u5EF6\u8FDF (ms)",
  retryJitter: "\u6296\u52A8\u6BD4\u4F8B",
  retryBackoff: "\u9000\u907F",
  retryValueNumber: "\u8BF7\u8F93\u5165\u6570\u5B57\u3002",
  retryValueInteger: "\u8BF7\u8F93\u5165\u6574\u6570\u3002",
  retryValuePositive: "\u5FC5\u987B\u5927\u4E8E 0\u3002",
  retryValueMin: "\u4E0D\u80FD\u5C0F\u4E8E {min}\u3002",
  retryValueMax: "\u4E0D\u80FD\u5927\u4E8E {max}\u3002",
  retryCodesInvalid: "\u9519\u8BEF\u7801\u5FC5\u987B\u662F\u975E\u7A7A\u6587\u672C\u3002",
  retryCodesDuplicate: "\u6BCF\u4E2A\u9519\u8BEF\u7801\u53EA\u80FD\u51FA\u73B0\u4E00\u6B21\u3002",
  retryDelayOrder: "\u521D\u59CB\u5EF6\u8FDF\u4E0D\u80FD\u5927\u4E8E\u6700\u5927\u5EF6\u8FDF\u3002",
  models: "\u6A21\u578B\u76EE\u5F55",
  modelsInherited: "\u6B63\u5728\u4F7F\u7528\u9002\u914D\u5668\u9ED8\u8BA4\u6A21\u578B",
  modelsCustomized: "\u5DF2\u81EA\u5B9A\u4E49\u6A21\u578B\u76EE\u5F55",
  resetModels: "\u6062\u590D\u9ED8\u8BA4\u6A21\u578B",
  model: "\u6A21\u578B",
  modelId: "\u6A21\u578B ID",
  modelName: "\u663E\u793A\u540D\u79F0",
  modelNamePlaceholder: "\u7559\u7A7A\u65F6\u4F7F\u7528\u6A21\u578B ID",
  contextWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
  contextWindowPlaceholder: "\u4F7F\u7528\u63D0\u4F9B\u5546\u9ED8\u8BA4\u503C",
  maxTokens: "\u6700\u5927\u8F93\u51FA token \u6570",
  maxTokensPlaceholder: "\u4F7F\u7528\u63D0\u4F9B\u5546\u9ED8\u8BA4\u503C",
  modelAdvanced: "\u6A21\u578B\u9009\u9879",
  modelInputTypes: "\u8F93\u5165\u7C7B\u578B",
  modelInputText: "\u6587\u672C",
  modelInputImage: "\u56FE\u7247",
  modelReasoning: "\u63A8\u7406\u7B49\u7EA7",
  modelReasoningLevel: "\u6863\u4F4D",
  modelReasoningValue: "API \u53C2\u6570\u503C",
  modelReasoningHelp: "\u63A8\u7406\u7B49\u7EA7\u8BF4\u660E",
  modelReasoningHelpText: "API \u53C2\u6570\u503C\u4F1A\u5199\u5165\u8BF7\u6C42\u7684\u63A8\u7406\u5F3A\u5EA6\u5B57\u6BB5\uFF08\u5982 OpenAI \u7684 reasoning_effort\uFF09\uFF0C\u9ED8\u8BA4\u4E0E\u6863\u4F4D\u540D\u76F8\u540C\uFF1B\u5982\u6709\u4E0D\u540C\uFF0C\u4EE5\u6A21\u578B\u63D0\u4F9B\u5546\u7684 API \u6587\u6863\u4E3A\u51C6\u3002Off \u8868\u793A\u5173\u95ED\u601D\u8003\uFF0C\u4E0D\u9700\u8981\u586B\u5199\u53C2\u6570\u503C\uFF1B\u914D\u7F6E\u4E2D\u5DF2\u5199\u5165\u7684\u503C\u4F1A\u4FDD\u7559\u5E76\u53D1\u9001\u3002",
  modelReasoningNeedsLevel: "\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A Off \u4EE5\u5916\u7684\u6863\u4F4D\uFF1B\u4E0D\u9700\u8981\u601D\u8003\u8BF7\u5173\u95ED\u63A8\u7406\u7B49\u7EA7\u3002",
  modelReasoningValueRequired: "Off \u4EE5\u5916\u7684\u6863\u4F4D\u90FD\u9700\u8981\u586B\u5199 API \u53C2\u6570\u503C\uFF0C\u4E14\u53C2\u6570\u503C\u4E0D\u80FD\u4E3A\u7A7A\u5B57\u7B26\u4E32\u3002",
  modelReasoningLevelsOnly: "\u6B64 API \u534F\u8BAE\u4EC5\u63A5\u53D7 minimal\u3001low\u3001medium \u548C high \u6863\u4F4D\uFF0C\u4E14\u6BCF\u4E2A\u6863\u4F4D\u7684 API \u53C2\u6570\u503C\u987B\u4E0E\u6863\u4F4D\u540D\u79F0\u76F8\u540C\u3002\u8BF7\u4FEE\u6539\u6216\u5220\u9664\u5176\u4ED6\u6863\u4F4D\u3002",
  modelReasoningAdd: "\u6DFB\u52A0\u6863\u4F4D",
  modelReasoningRemove: "\u5220\u9664\u6863\u4F4D",
  modelReasoningOffValuePlaceholder: "\u5173\u95ED\u601D\u8003",
  addModel: "\u6DFB\u52A0\u6A21\u578B",
  removeModel: "\u5220\u9664\u6A21\u578B",
  reorderModel: "\u8C03\u6574\u6A21\u578B\u987A\u5E8F",
  reorderModelHelp: "\u62D6\u52A8\u6392\u5E8F\uFF0C\u6216\u4F7F\u7528\u4E0A\u4E0B\u65B9\u5411\u952E\u8C03\u6574\u987A\u5E8F\u3002",
  modelsEmpty: "\u6A21\u578B\u9009\u62E9\u5668\u4E2D\u5C06\u4E0D\u663E\u793A\u4EFB\u4F55\u6A21\u578B\uFF1B\u76EE\u5F55\u5916 ID \u4ECD\u53EF\u76F4\u63A5\u53D1\u9001\u3002",
  keyBlank: "\u8BF7\u8F93\u5165 API \u5BC6\u94A5\uFF1B\u7559\u7A7A\u5219\u4FDD\u6301\u5DF2\u5B58\u50A8\u7684\u5BC6\u94A5\u3002",
  keyBlankNew: "\u8BF7\u8F93\u5165 API \u5BC6\u94A5\uFF1B\u82E5\u8BE5\u63D0\u4F9B\u5546\u4EE5\u5176\u4ED6\u65B9\u5F0F\u9274\u6743\uFF0C\u53EF\u4EE5\u7559\u7A7A\u3002",
  keyIllegalCharacters: "\u8BE5 API \u5BC6\u94A5\u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u3002",
  modelIdRequired: "\u6A21\u578B ID \u4E0D\u80FD\u4E3A\u7A7A\u3002",
  modelIdDuplicate: "\u6A21\u578B ID \u4E0D\u80FD\u91CD\u590D\u3002",
  modelNameInvalid: "\u663E\u793A\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002",
  modelContextInvalid: "\u4E0A\u4E0B\u6587\u7A97\u53E3\u5FC5\u987B\u662F\u6B63\u6570\uFF0C\u4F8B\u5982 131072\u3001256K \u6216 1M\u3002",
  modelMaxTokensInvalid: "\u6700\u5927\u8F93\u51FA token \u6570\u5FC5\u987B\u662F\u6B63\u6570\uFF0C\u4F8B\u5982 8192\u300164K \u6216 1M\u3002",
  advancedHint: "\u5176\u4F59\u5B57\u6BB5\u5728 cordis.patch.yml \u4E2D\uFF0C\u8BF7\u76F4\u63A5\u7F16\u8F91\u5BF9\u5E94\u6BB5\u3002",
  modelCapacityInvalid: "\u5BB9\u91CF\u9700\u4E3A\u6570\u5B57\uFF0C\u53EF\u52A0 K \u6216 M \u540E\u7F00\u3002",
  modelDuplicate: "\u6BCF\u4E2A\u6A21\u578B ID \u53EA\u80FD\u51FA\u73B0\u4E00\u6B21\u3002",
  fetchModels: "\u83B7\u53D6\u53EF\u7528\u6A21\u578B",
  fetching: "\u6B63\u5728\u8BE2\u95EE\u63D0\u4F9B\u5546\u2026",
  fetchNeedsBaseUrl: "\u8BF7\u5148\u586B\u5199 API \u5730\u5740\uFF0C\u518D\u83B7\u53D6\u3002",
  fetchEmpty: "\u8BE5\u63D0\u4F9B\u5546\u6CA1\u6709\u5217\u51FA\u4EFB\u4F55\u6A21\u578B\uFF0C\u8BF7\u624B\u52A8\u6DFB\u52A0\u3002",
  fetchTitle: "\u9009\u62E9\u6A21\u578B",
  fetchDescription: "\u4EE5\u4E0B\u662F\u6A21\u578B\u63D0\u4F9B\u5546\u7684\u53EF\u7528\u6A21\u578B\uFF0C\u52FE\u9009\u7684\u6A21\u578B\u5373\u4E3A\u6A21\u578B\u5217\u8868\u3002",
  fetchSearch: "\u641C\u7D22\u6A21\u578B",
  fetchNoMatches: "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B\u3002",
  fetchSelectAll: "\u5168\u9009",
  fetchDeselectAll: "\u53D6\u6D88\u5168\u9009",
  fetchAdopt: "\u66F4\u65B0\u5217\u8868",
  fetchKeepOne: "\u8BF7\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u52FE\u9009\u7684\u6A21\u578B\u3002",
  customTag: "\u81EA\u5B9A\u4E49",
  customRoute: "Provider ID",
  customRouteHint: "\u4EE5\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684\u6807\u8BC6\uFF0C\u5728\u8BF7\u6C42\u4E2D\u552F\u4E00\u6807\u8BC6\u8BE5\u63D0\u4F9B\u5546\uFF0C\u5E76\u7528\u4E8E\u6D3E\u751F\u51ED\u636E\u540D\u3002",
  customRouteInvalid: "\u9700\u4EE5\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u4E4B\u540E\u53EF\u7528\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u77ED\u6A2A\u7EBF\u3002",
  customRouteTaken: "\u5DF2\u6709\u63D0\u4F9B\u5546\u4F7F\u7528\u4E86\u8FD9\u4E2A ID\u3002",
  customDisplayName: "\u663E\u793A\u540D\u79F0",
  customApi: "API \u534F\u8BAE",
  customApiUnset: "\u672A\u9009\u62E9",
  protocolOpenAiCompletions: "OpenAI Chat Completions",
  protocolOpenAiResponses: "OpenAI Responses",
  protocolAnthropicMessages: "Anthropic Messages",
  protocolGemini: "Gemini API",
  customNeedsBaseUrl: "\u81EA\u5B9A\u4E49\u6A21\u578B API \u9700\u8981\u586B\u5199 API \u5730\u5740\u3002",
  customBaseUrlInvalid: "\u8BF7\u8F93\u5165\u6709\u6548\u7684 HTTP \u6216 HTTPS \u5730\u5740\u3002",
  customNeedsModels: "\u81EA\u5B9A\u4E49\u6A21\u578B API \u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6A21\u578B\u3002",
  customBaseUrlPlaceholder: "https://gateway.example/v1",
  customAnthropicBaseUrlPlaceholder: "https://gateway.example",
  customGeminiBaseUrlPlaceholder: "https://gateway.example/v1beta",
  settingsPathUnresolvable: "\u65E0\u6CD5\u89E3\u6790\u8BBE\u7F6E\u8DEF\u5F84",
  create: "\u521B\u5EFA\u63D0\u4F9B\u5546",
  creating: "\u521B\u5EFA\u4E2D\u2026",
  welcomeTitle: "\u9884\u89C8\u7248\u8BF4\u660E",
  welcomeBody: "DeepSeek Harness \u76EE\u524D\u7684 0.2 \u7248\u672C\u4ECD\u5904\u4E8E\u9884\u89C8\u9636\u6BB5\uFF0C\u8FD8\u6709\u8BB8\u591A\u5730\u65B9\u9700\u8981\u6301\u7EED\u6539\u8FDB\u548C\u6253\u78E8\uFF0C\u5E0C\u671B\u542C\u53D6\u5E7F\u5927\u5F00\u53D1\u8005\u548C\u7528\u6237\u7684\u53CD\u9988\u5EFA\u8BAE\u3002\u73B0\u5728\uFF0C\u65B0\u7684\u684C\u9762\u7AEF\u9762\u5411\u5E7F\u6CDB\u7528\u6237\uFF0C\u5F00\u53D1\u8005\u76F8\u5173\u7684\u8FDB\u9636\u529F\u80FD\u53EF\u5728\u914D\u7F6E\u4E2D\u5F00\u542F\u4F7F\u7528\u3002\u9884\u8BA1 DeepSeek Harness \u7684\u4EA7\u54C1\u529F\u80FD\u4EE5\u53CA\u63D2\u4EF6 API \u90FD\u4F1A\u7EE7\u7EED\u5FEB\u901F\u8FED\u4EE3\u3001\u6301\u7EED\u6F14\u5316\uFF0C\u5E76\u9010\u6E10\u8D8B\u4E8E\u7A33\u5B9A\u3002\n\n\u6211\u4EEC\u671F\u5F85\u4E0E\u5168\u7403\u7528\u6237\u548C\u5F00\u53D1\u8005\u4E00\u8D77\uFF0C\u5728\u5F00\u6E90\u3001\u53EF\u590D\u7528\u3001\u53EF\u7EC4\u5408\u7684\u57FA\u7840\u8BBE\u65BD\u4E4B\u4E0A\uFF0C\u5171\u540C\u63A2\u7D22\u667A\u80FD\u4E0A\u9650\u3002\u6B22\u8FCE\u5927\u5BB6\u7528 DeepSeek Harness \u5C06\u60F3\u6CD5\u53D8\u6210\u73B0\u5B9E\uFF0C\u4E0E\u793E\u533A\u4E00\u8D77\u4E30\u5BCC\u63D2\u4EF6\u751F\u6001\u3002",
  welcomeContinue: "\u7EE7\u7EED",
  welcomeError: "\u6682\u65F6\u65E0\u6CD5\u4FDD\u5B58\u786E\u8BA4\u72B6\u6001\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  onboardingTitle: "\u6DFB\u52A0\u4E00\u4E2A API Key \u5F00\u59CB\u4F7F\u7528",
  onboardingDescription: "\u914D\u7F6E DeepSeek \u5B98\u65B9\u6A21\u578B\uFF0C\u5373\u53EF\u5F00\u59CB\u4F7F\u7528\u3002",
  onboardingLater: "\u7A0D\u540E\u914D\u7F6E",
  onboardingSave: "\u4FDD\u5B58\u5E76\u7EE7\u7EED",
  onboardingSaving: "\u4FDD\u5B58\u4E2D\u2026",
  keyRequired: "\u8BF7\u8F93\u5165 API \u5BC6\u94A5\u540E\u7EE7\u7EED\u3002"
};

// deepseek-harness/packages/util/crypto/src/index.ts
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte;
    return pinned.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// desktop/compat/src/bridge.ts
async function request(method, params = {}) {
  if (!window.mygo) throw Error("\u539F\u751F\u8FDE\u63A5\u4E0D\u53EF\u7528\u3002");
  return window.mygo.call("CompatAPI.Request", method, params);
}
var operationId = () => randomUUID();

// desktop/compat/src/rpc-adapter.ts
var safeRejections = /* @__PURE__ */ new Set(["INVALID_ARGUMENT", "STALE_CONTEXT", "READ_ONLY", "NOT_CONNECTED", "UNSUPPORTED_OPERATION", "REMOTE_NAMESPACE_FROZEN", "REMOTE_PLUGIN_FROZEN"]);
function createPageRpc(ctx, call = request) {
  const intents = /* @__PURE__ */ new Map();
  const scope = { hostId: ctx.hostId, generation: ctx.connectionGeneration, sessionId: ctx.sessionId, ownerId: ctx.ownerId };
  const read = async (method, params = {}) => {
    try {
      return { ok: true, value: await call(method, { ...params, clientScope: scope }) };
    } catch (error) {
      return { ok: false, error: { code: error.code ?? "FAILED", message: error.message } };
    }
  };
  const write2 = (method, params = {}) => {
    if (!ctx.operations?.[method]) return Promise.resolve({ ok: false, error: { code: "UNSUPPORTED_OPERATION", message: "\u5F53\u524D\u8FDC\u7A0B\u8FDE\u63A5\u672A\u5F00\u653E\u6B64\u64CD\u4F5C\u3002", delivery: "rejected" } });
    const key = JSON.stringify([method, params]);
    const existing = intents.get(key);
    if (existing) return existing.promise;
    const id = operationId();
    const entry = { id, promise: Promise.resolve(null) };
    entry.promise = Promise.resolve().then(async () => {
      try {
        const result = await call(method, { ...params, requestId: id, clientScope: scope });
        if (result.status !== "accepted") return { ok: false, error: { code: "RECEIPT_UNKNOWN", message: "\u54CD\u5E94\u672A\u786E\u8BA4\u3002\u4E0D\u4F1A\u81EA\u52A8\u91CD\u53D1\u6B64\u64CD\u4F5C\uFF0C\u8BF7\u5148\u6838\u5BF9\u8FDC\u7A0B\u72B6\u6001\u3002" } };
        if (result.requestId !== id || result.hostId !== ctx.hostId || result.connectionGeneration !== ctx.connectionGeneration) return { ok: false, error: { code: "RECEIPT_SCOPE_MISMATCH", message: "\u54CD\u5E94\u6765\u6E90\u4E0E\u6253\u5F00\u9875\u9762\u65F6\u7684\u8FDE\u63A5\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u6838\u5BF9\u72B6\u6001\u3002" } };
        intents.delete(key);
        return { ok: true, value: result.value };
      } catch (error) {
        const rejected = error.delivery === "rejected" || safeRejections.has(error.code);
        if (rejected) intents.delete(key);
        return { ok: false, error: { code: error.code ?? "FAILED", message: error.message, ...rejected ? { delivery: "rejected" } : {} } };
      }
    });
    intents.set(key, entry);
    return entry.promise;
  };
  return { read, write: write2 };
}

// desktop/compat/src/presentation.tsx
import { useSyncExternalStore } from "react";
var translate = (dictionary) => (key, params = {}) => (dictionary[key] ?? key).replace(
  /\{(\w+)\}/g,
  (_, name) => String(params[name] ?? "")
);
function hook(source) {
  return function useSnapshotSelector(selector = (s) => s) {
    return selector(useSyncExternalStore(source.subscribe, source.getSnapshot));
  };
}

// desktop/compat/src/model-settings.tsx
import { jsx as jsx21 } from "react/jsx-runtime";
function createModelSettings(ctx) {
  const rpc = createPageRpc(ctx);
  let mirror;
  const remote = {
    llm: { listProviders: () => rpc.read("listProviders"), listConfigurableProviders: () => rpc.read("listConfigurableProviders"), discoverModels: (settingsNs, request2) => rpc.read("discoverModels", { settingsNs, request: request2 }) },
    session: { modelCatalog: () => rpc.read("modelCatalog") },
    credentials: { describe: (refs) => rpc.read("describeCredentials", { refs }), set: (ref, value) => rpc.write("setCredential", { ref, value }), unset: (ref) => rpc.write("unsetCredential", { ref }) },
    settings: {
      describe: async () => {
        const result = await rpc.read("describeSettings");
        return result.ok ? { ...result, value: { ...result.value, writable: result.value.writable && !!ctx.operations?.mutateSettings } } : result;
      },
      mutate: async (ns, ops, expectedRevision) => {
        const result = await rpc.write("mutateSettings", { ns, ops, expectedRevision });
        if (result.ok) mirror.acceptView(result.value);
        return result;
      }
    }
  };
  const facade = { remote };
  mirror = new SettingsDescribeMirror(facade);
  const schema = createSettingsSchemaOperations(new SettingsSchemaService(void 0));
  const controller = new ModelsSettingsStore(facade, schema, mirror);
  const operations = createModelsOperations(facade);
  return { controller, operations, schema };
}
function ModelSettingsPage({ ctx }) {
  const face = useMemo4(() => createModelSettings(ctx), [ctx]);
  return /* @__PURE__ */ jsx21("main", { className: "compat-settings-frame", children: /* @__PURE__ */ jsx21(
    ModelsSection,
    {
      ...face,
      useSnapshot: hook(face.controller.store),
      t: translate(zh),
      renderSlot: (_name, _props, options) => options?.fallback ?? null
    }
  ) });
}
export {
  createModelSettings,
  ModelSettingsPage as default
};
