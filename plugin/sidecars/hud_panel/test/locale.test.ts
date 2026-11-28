import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 as win32Path } from 'node:path';
import test from 'node:test';

import {
  LOCALE_CACHE_TTL_MS,
  LOCALE_SCORE_THRESHOLD,
  collectLocaleSignals,
  detectLocale,
  evaluateLocaleSignals,
  hasChineseRegionTag,
  isChineseLocaleTag,
  isChineseTimezone,
  matchesChineseFontName,
  parseAppleLanguages,
  parseLocaleConf,
  parseMacOsInputSources,
  parseWindowsPowerShellLocale,
  parseWindowsRegLocale,
  resetLocaleMemoryCache,
  type LocaleProbeDeps,
} from '../lib/locale.ts';

function makeMockDeps(overrides: Partial<LocaleProbeDeps> = {}): LocaleProbeDeps {
  return {
    platform: 'darwin',
    env: { LANG: 'en_US.UTF-8' },
    intlLocale: 'en-US',
    intlTimeZone: 'America/Los_Angeles',
    homeDir: '/Users/tester',
    now: () => 1_750_000_000_000,
    execFile: () => '',
    readTextFile: () => '',
    listDirEntries: () => [],
    dirExists: () => false,
    ...overrides,
  };
}

test('locale parsers handle macOS, Linux, Windows outputs and tag classifiers accurately', () => {
  assert.deepEqual(
    parseAppleLanguages('(\n    "en-US",\n    "zh-Hans-CN",\n    ja\n)'),
    ['en-US', 'zh-Hans-CN', 'ja'],
  );
  assert.deepEqual(
    parseLocaleConf('# comment\nLANG="zh_CN.UTF-8"\nLC_MESSAGES=en_US.UTF-8\nLANGUAGE=zh_CN:en\n'),
    { LANG: 'zh_CN.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANGUAGE: 'zh_CN:en' },
  );
  assert.deepEqual(
    parseMacOsInputSources(
      '({"Bundle ID" = "com.apple.inputmethod.SCIM"; "Input Mode" = "com.apple.inputmethod.SCIM.ITABC";})',
    ),
    ['SCIM', 'PinyinMode'],
  );
  assert.deepEqual(
    parseWindowsPowerShellLocale('UI=en-US\r\nCULTURE=en-CN\r\nLIST=en-US,zh-Hans-CN\r\n'),
    { uiCulture: 'en-US', culture: 'en-CN', languageList: ['en-US', 'zh-Hans-CN'] },
  );
  assert.equal(
    parseWindowsRegLocale('\r\nHKEY_CURRENT_USER\\Control Panel\\International\r\n    LocaleName    REG_SZ    zh-CN\r\n'),
    'zh-CN',
  );

  assert.equal(isChineseLocaleTag('zh_CN.UTF-8'), true);
  assert.equal(isChineseLocaleTag('zh-Hans-SG'), true);
  assert.equal(isChineseLocaleTag('zh-Hant-TW'), true);
  assert.equal(isChineseLocaleTag('en_US.UTF-8'), false);
  assert.equal(isChineseLocaleTag('C'), false);
  assert.equal(isChineseLocaleTag('POSIX'), false);

  assert.equal(hasChineseRegionTag('en_CN'), true);
  assert.equal(hasChineseRegionTag('en-HK'), true);
  assert.equal(hasChineseRegionTag('en_US@rg=cnzzzz'), true);
  assert.equal(hasChineseRegionTag('en_US'), false);
  assert.equal(hasChineseRegionTag('en_SG'), false);

  assert.equal(isChineseTimezone('Asia/Shanghai'), true);
  assert.equal(isChineseTimezone('Asia/Taipei'), true);
  assert.equal(isChineseTimezone('Asia/Hong_Kong'), true);
  assert.equal(isChineseTimezone('Asia/Chongqing'), true);
  assert.equal(isChineseTimezone('Asia/Urumqi'), true);
  assert.equal(isChineseTimezone('Asia/Macau'), true);
  assert.equal(isChineseTimezone('America/Los_Angeles'), false);
  assert.equal(isChineseTimezone('Asia/Singapore'), false);
  assert.equal(isChineseTimezone('Asia/Tokyo'), false);

  assert.equal(matchesChineseFontName('PingFang.ttc'), true);
  assert.equal(matchesChineseFontName('LXGWWenKai-Regular.ttf'), true);
  assert.equal(matchesChineseFontName('NotoSansCJK-Regular.ttc'), true);
  assert.equal(matchesChineseFontName('NotoSansSC-Regular.otf'), true);
  assert.equal(matchesChineseFontName('SourceHanSansCN-Normal.otf'), true);
  assert.equal(matchesChineseFontName('Hiragino Sans GB.ttc'), true);
  assert.equal(matchesChineseFontName('msyh.ttc'), true);
  assert.equal(matchesChineseFontName('思源黑体.otf'), true);
  // Non-Chinese fonts must NOT match
  assert.equal(matchesChineseFontName('NotoSansCJKjp-Regular.otf'), false);
  assert.equal(matchesChineseFontName('SourceHanSansJP-Regular.otf'), false);
  assert.equal(matchesChineseFontName('SourceHanSansKR-Regular.otf'), false);
  assert.equal(matchesChineseFontName('Hiragino Sans.ttc'), false);
  assert.equal(matchesChineseFontName('ヒラギノ角ゴシック W3.ttc'), false);
  assert.equal(matchesChineseFontName('ヒラギノ明朝 ProN.ttc'), false);
  assert.equal(matchesChineseFontName('나눔고딕.ttf'), false);
  assert.equal(matchesChineseFontName('Inter-Regular.ttf'), false);
});

test('explicit zh* OS/env/Intl locales immediately yield zh with high confidence', () => {
  const cases: Partial<LocaleProbeDeps>[] = [
    { env: { LC_ALL: 'zh_CN.UTF-8' } },
    { env: { LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' } },
    { env: { LANG: 'zh_HK.UTF-8' } },
    { env: { LANGUAGE: 'zh_CN:en_US', LANG: 'C' } },
    { env: { LANG: 'en_US.UTF-8' }, intlLocale: 'zh-Hans-CN' },
    {
      platform: 'darwin',
      env: { LANG: 'en_US.UTF-8' },
      execFile: (file, args) => {
        if (file === 'defaults' && args[2] === 'AppleLanguages') {
          return '(\n "zh-Hans-CN",\n "en-US"\n)';
        }
        return '';
      },
    },
  ];

  for (const overrides of cases) {
    resetLocaleMemoryCache();
    const res = detectLocale({ cachePath: null, deps: makeMockDeps(overrides) });
    assert.equal(res.lang, 'zh');
    assert.equal(res.score, 1);
    assert.ok(res.confidence >= 0.95);
    assert.equal(res.signals.scoreBreakdown.primaryLocale, 1);
  }
});

test('anti-false-positive: US English macOS user with default system PingFang.ttc stays en', () => {
  resetLocaleMemoryCache();
  const deps = makeMockDeps({
    platform: 'darwin',
    env: { LANG: 'en_US.UTF-8' },
    intlLocale: 'en-US',
    intlTimeZone: 'America/Los_Angeles',
    execFile: (file, args) => {
      if (file === 'defaults' && args[2] === 'AppleLanguages') return '(\n "en-US"\n)';
      if (file === 'defaults' && args[2] === 'AppleLocale') return 'en_US';
      if (file === 'defaults' && args[2] === 'AppleEnabledInputSources') {
        return '({ InputSourceKind = "Keyboard Layout"; "KeyboardLayout Name" = ABC; })';
      }
      return '';
    },
    dirExists: (dir) => dir === '/System/Library/Fonts' || dir === '/System/Library/Fonts/Supplemental',
    listDirEntries: (dir) => {
      if (dir === '/System/Library/Fonts') {
        return [
          { name: 'PingFang.ttc', isDir: false },
          { name: 'STHeiti Light.ttc', isDir: false },
          { name: 'Hiragino Sans GB.ttc', isDir: false },
        ];
      }
      if (dir === '/System/Library/Fonts/Supplemental') {
        return [{ name: 'Songti.ttc', isDir: false }];
      }
      return [];
    },
  });

  const res = detectLocale({ cachePath: null, deps });
  assert.equal(res.lang, 'en');
  assert.equal(res.score, 0);
  assert.equal(res.confidence, 1);
  assert.equal(res.signals.fonts.systemOnly, true);
  assert.ok(res.signals.fonts.systemChineseFonts.includes('PingFang.ttc'));
  assert.equal(res.signals.fonts.userChineseFonts.length, 0);
  assert.equal(res.signals.scoreBreakdown.fonts, 0);
});

test('anti-false-positive: English traveler in Asia/Shanghai without secondary CJK signals stays en', () => {
  resetLocaleMemoryCache();
  const deps = makeMockDeps({
    platform: 'darwin',
    env: { LANG: 'en_US.UTF-8' },
    intlLocale: 'en-US',
    intlTimeZone: 'Asia/Shanghai',
    execFile: (file, args) => {
      if (file === 'defaults' && args[2] === 'AppleLanguages') return '(\n "en-US"\n)';
      if (file === 'defaults' && args[2] === 'AppleLocale') return 'en_US';
      return '';
    },
    dirExists: (dir) => dir === '/System/Library/Fonts',
    listDirEntries: (dir) =>
      dir === '/System/Library/Fonts' ? [{ name: 'PingFang.ttc', isDir: false }] : [],
  });

  const res = detectLocale({ cachePath: null, deps });
  assert.equal(res.lang, 'en');
  assert.ok(res.score < LOCALE_SCORE_THRESHOLD);
  assert.equal(res.signals.isChineseTimezone, true);
  assert.equal(res.signals.scoreBreakdown.timezone, 0.35);
  assert.equal(res.signals.scoreBreakdown.fonts, 0);
});

test('English macOS user in Asia/Shanghai with zh-Hans secondary language or user Chinese fonts detects zh', () => {
  // Case A: Asia/Shanghai + zh-Hans in AppleLanguages
  resetLocaleMemoryCache();
  const resSecondary = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'darwin',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'Asia/Shanghai',
      execFile: (file, args) => {
        if (file === 'defaults' && args[2] === 'AppleLanguages') {
          return '(\n "en-US",\n "zh-Hans-CN"\n)';
        }
        if (file === 'defaults' && args[2] === 'AppleLocale') return 'en_US';
        return '';
      },
    }),
  });
  assert.equal(resSecondary.lang, 'zh');
  assert.equal(resSecondary.score, 0.8);
  assert.equal(resSecondary.signals.scoreBreakdown.secondaryLocale, 0.45);
  assert.equal(resSecondary.signals.scoreBreakdown.timezone, 0.35);

  // Case B: Asia/Shanghai + user-installed Chinese font in ~/Library/Fonts
  resetLocaleMemoryCache();
  const resUserFont = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'darwin',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'Asia/Shanghai',
      execFile: (file, args) => {
        if (file === 'defaults' && args[2] === 'AppleLanguages') return '(\n "en-US"\n)';
        if (file === 'defaults' && args[2] === 'AppleLocale') return 'en_US';
        return '';
      },
      dirExists: (dir) => dir === '/Users/tester/Library/Fonts',
      listDirEntries: (dir) =>
        dir === '/Users/tester/Library/Fonts'
          ? [{ name: 'LXGWWenKai-Regular.ttf', isDir: false }]
          : [],
    }),
  });
  assert.equal(resUserFont.lang, 'zh');
  assert.equal(resUserFont.score, 0.65);
  assert.equal(resUserFont.signals.fonts.systemOnly, false);
  assert.equal(resUserFont.signals.scoreBreakdown.fonts, 0.3);

  // Case C: US timezone + zh-Hans secondary + Chinese Pinyin IME (overseas Chinese developer)
  resetLocaleMemoryCache();
  const resOverseas = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'darwin',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'America/Los_Angeles',
      execFile: (file, args) => {
        if (file === 'defaults' && args[2] === 'AppleLanguages') {
          return '(\n "en-US",\n "zh-Hans-US"\n)';
        }
        if (file === 'defaults' && args[2] === 'AppleEnabledInputSources') {
          return '({ "Bundle ID" = "com.apple.inputmethod.SCIM"; })';
        }
        return '';
      },
    }),
  });
  assert.equal(resOverseas.lang, 'zh');
  assert.equal(resOverseas.score, 0.75);
  assert.equal(resOverseas.signals.chineseInputMethod, true);

  // Case D: Asia/Shanghai + AppleLocale en_CN region
  resetLocaleMemoryCache();
  const resRegion = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'darwin',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'Asia/Shanghai',
      execFile: (file, args) => {
        if (file === 'defaults' && args[2] === 'AppleLanguages') return '(\n "en-US"\n)';
        if (file === 'defaults' && args[2] === 'AppleLocale') return 'en_CN';
        return '';
      },
    }),
  });
  assert.equal(resRegion.lang, 'zh');
  assert.equal(resRegion.score, 0.7);
  assert.equal(resRegion.signals.scoreBreakdown.regionLocale, 0.35);
});

test('Linux and Windows platform probes score accurately without false positives', () => {
  // Linux: English locale in Asia/Shanghai + fc-list :lang=zh -> zh (0.35 + 0.25 = 0.60)
  resetLocaleMemoryCache();
  const linuxZh = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'linux',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'Asia/Shanghai',
      readTextFile: (p) => (p === '/etc/locale.conf' ? 'LANG=en_US.UTF-8\n' : ''),
      execFile: (file, args) =>
        file === 'fc-list' && args[0] === ':lang=zh'
          ? 'Noto Sans CJK SC\nWenQuanYi Micro Hei\n'
          : '',
    }),
  });
  assert.equal(linuxZh.lang, 'zh');
  assert.equal(linuxZh.score, 0.6);
  assert.ok(linuxZh.signals.fonts.fcListChineseFonts.includes('Noto Sans CJK SC'));

  // Linux: English locale in America/Los_Angeles + fc-list :lang=zh -> en (0.25 < 0.60)
  resetLocaleMemoryCache();
  const linuxEn = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'linux',
      env: { LANG: 'en_US.UTF-8' },
      intlLocale: 'en-US',
      intlTimeZone: 'America/Los_Angeles',
      readTextFile: (p) => (p === '/etc/locale.conf' ? 'LANG=en_US.UTF-8\n' : ''),
      execFile: (file) => (file === 'fc-list' ? 'Noto Sans CJK SC\n' : ''),
    }),
  });
  assert.equal(linuxEn.lang, 'en');
  assert.equal(linuxEn.score, 0.25);

  // Windows: US English with system msyh.ttc -> en (0.15 < 0.60)
  resetLocaleMemoryCache();
  const winEn = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'win32',
      env: { WINDIR: 'C:\\Windows' },
      intlLocale: 'en-US',
      intlTimeZone: 'America/Los_Angeles',
      execFile: (file) =>
        file === 'powershell.exe' ? 'UI=en-US\r\nCULTURE=en-US\r\nLIST=en-US\r\n' : '',
      dirExists: (d) => d === win32Path.join('C:\\Windows', 'Fonts'),
      listDirEntries: (d) =>
        d === win32Path.join('C:\\Windows', 'Fonts') ? [{ name: 'msyh.ttc', isDir: false }] : [],
    }),
  });
  assert.equal(winEn.lang, 'en');
  assert.equal(winEn.score, 0.15);

  // Windows: English UI + zh-CN in Get-WinUserLanguageList + Asia/Shanghai -> zh
  resetLocaleMemoryCache();
  const winZh = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'win32',
      env: {},
      intlLocale: 'en-US',
      intlTimeZone: 'Asia/Shanghai',
      execFile: (file) =>
        file === 'powershell.exe' ? 'UI=en-US\r\nCULTURE=en-CN\r\nLIST=en-US,zh-Hans-CN\r\n' : '',
    }),
  });
  assert.equal(winZh.lang, 'zh');
  assert.equal(winZh.score, 1);

  // Windows fallback to reg.exe when PowerShell fails
  resetLocaleMemoryCache();
  const winRegFallback = detectLocale({
    cachePath: null,
    deps: makeMockDeps({
      platform: 'win32',
      env: {},
      intlLocale: 'en-US',
      intlTimeZone: 'America/Los_Angeles',
      execFile: (file) =>
        file === 'reg'
          ? 'HKEY_CURRENT_USER\\Control Panel\\International\r\n    LocaleName    REG_SZ    zh-TW\r\n'
          : '',
    }),
  });
  assert.equal(winRegFallback.lang, 'zh');
  assert.equal(winRegFallback.signals.osPrimaryLocale, 'zh-TW');
});

test('disk and memory caching run probes once, survive restarts, and invalidate on fingerprint or TTL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-locale-test-'));
  const cachePath = join(dir, 'locale.json');
  try {
    resetLocaleMemoryCache();
    let probeCalls = 0;
    let clock = 1_750_000_000_000;

    const makeCountingDeps = (env: Record<string, string>) =>
      makeMockDeps({
        platform: 'darwin',
        env,
        intlLocale: 'en-US',
        intlTimeZone: 'Asia/Shanghai',
        now: () => clock,
        execFile: (file, args) => {
          probeCalls++;
          if (file === 'defaults' && args[2] === 'AppleLanguages') {
            return '(\n "en-US",\n "zh-Hans-CN"\n)';
          }
          return '';
        },
      });

    // 1. Cold start -> runs OS probes once and persists to disk
    const first = detectLocale({ cachePath, deps: makeCountingDeps({ LANG: 'en_US.UTF-8' }) });
    assert.equal(first.lang, 'zh');
    assert.equal(first.cached, false);
    assert.ok(probeCalls > 0);
    assert.equal(existsSync(cachePath), true);
    const probesAfterFirst = probeCalls;

    // 2. Second call -> memory cache hit (0 additional probes)
    const second = detectLocale({ cachePath, deps: makeCountingDeps({ LANG: 'en_US.UTF-8' }) });
    assert.equal(second.lang, 'zh');
    assert.equal(second.cached, true);
    assert.equal(probeCalls, probesAfterFirst);

    // 3. Simulated process restart (clear memory cache) -> disk cache hit (0 additional probes)
    resetLocaleMemoryCache();
    const third = detectLocale({ cachePath, deps: makeCountingDeps({ LANG: 'en_US.UTF-8' }) });
    assert.equal(third.lang, 'zh');
    assert.equal(third.cached, true);
    assert.equal(probeCalls, probesAfterFirst);

    // 4. Environment locale change -> fingerprint invalidation -> re-probes once
    const fourth = detectLocale({
      cachePath,
      deps: makeCountingDeps({ LANG: 'zh_CN.UTF-8' }),
    });
    assert.equal(fourth.lang, 'zh');
    assert.equal(fourth.cached, false);
    assert.ok(probeCalls > probesAfterFirst);
    const probesAfterFourth = probeCalls;

    // 5. Advance clock past TTL -> expires and re-probes
    clock += LOCALE_CACHE_TTL_MS + 1000;
    const fifth = detectLocale({
      cachePath,
      deps: makeCountingDeps({ LANG: 'zh_CN.UTF-8' }),
    });
    assert.equal(fifth.cached, false);
    assert.ok(probeCalls > probesAfterFourth);

    // 6. Corrupt disk cache file -> gracefully recovers without throwing
    resetLocaleMemoryCache();
    writeFileSync(cachePath, '{invalid json', 'utf8');
    const sixth = detectLocale({
      cachePath,
      deps: makeCountingDeps({ LANG: 'zh_CN.UTF-8' }),
    });
    assert.equal(sixth.lang, 'zh');
    assert.equal(sixth.cached, false);
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    assert.equal(parsed.result.lang, 'zh');

    // 7. Unwritable cache path (directory in place of file) -> falls back to memory without throwing
    resetLocaleMemoryCache();
    const badPath = join(dir, 'dir-as-file');
    mkdirSync(badPath, { recursive: true });
    const seventh = detectLocale({
      cachePath: badPath,
      deps: makeCountingDeps({ LANG: 'en_US.UTF-8' }),
    });
    assert.equal(seventh.lang, 'zh');
    assert.equal(seventh.cached, false);
    const eighth = detectLocale({
      cachePath: badPath,
      deps: makeCountingDeps({ LANG: 'en_US.UTF-8' }),
    });
    assert.equal(eighth.cached, true);
  } finally {
    resetLocaleMemoryCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evaluateLocaleSignals and collectLocaleSignals produce structured transparent breakdown', () => {
  const raw = collectLocaleSignals(
    makeMockDeps({
      platform: 'linux',
      env: { LANG: 'en_US.UTF-8', LANGUAGE: 'en_US:zh_CN', TZ: 'Asia/Taipei' },
      intlLocale: 'en-US',
      intlTimeZone: 'UTC',
    }),
  );
  const evaluated = evaluateLocaleSignals(raw);
  assert.equal(evaluated.lang, 'zh');
  assert.equal(evaluated.signals.timezone, 'Asia/Taipei');
  assert.equal(evaluated.signals.scoreBreakdown.secondaryLocale, 0.45);
  assert.equal(evaluated.signals.scoreBreakdown.timezone, 0.35);
  assert.equal(evaluated.score, 0.8);
});
