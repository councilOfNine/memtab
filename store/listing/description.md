<!--
  Chrome Web Store "Detailed description". Paste the text below the rule as plain text.

  No character limit is documented for this field, and no rich formatting is documented
  as supported — so this is written to read well as plain text, with blank lines and
  simple dashes rather than markdown that might render literally.

  The "What MemTab measures" section is not optional politeness. Overstating what the
  number means is the fastest route to one-star reviews and to a "functionality does not
  match the description" removal.
-->

---

Some tab is using two gigabytes. MemTab tells you which one.

It puts a small traffic light on every tab's favicon — green while a tab is healthy, amber as it grows, red once it passes the limit you set. The indicator is drawn around the site's own icon rather than replacing it, so your tabs still look like your tabs.


MADE TO FIT HOW YOU WORK

- Set the warning and high thresholds yourself, in megabytes or as a share of your device's heap limit.
- Four indicator styles: a ring around the icon, a solid plate behind it, a corner dot, or a bar whose length also encodes the level.
- Any colours you like. Stoplight by default, with a colour-blind-safe palette one click away, plus monochrome and neon.
- Every tab shows its level, green included, so you can see at a glance that MemTab is watching. Prefer quiet? One toggle marks only the tabs that need attention.
- Hysteresis stops a tab sitting on a threshold from flickering.
- Skip any site entirely, from the settings page or the popup.
- Settings sync across your Chrome profiles, and export to a file.


PRIVACY

MemTab makes no network requests at all. No analytics, no telemetry, no accounts, no third-party services. It reads a memory statistic and draws a favicon.

It never reads page content, form fields, passwords, cookies or browsing history. Your settings are stored in Chrome's own sync storage and go nowhere else.

There is no build step, so the source you can read on GitHub is exactly the code that runs.


WHAT MEMTAB MEASURES — PLEASE READ THIS FIRST

MemTab reads performance.memory, which is the only per-page memory figure a Chrome extension is allowed to see. It reports the JavaScript heap of the renderer process serving a site. Three things follow, and they are browser limitations rather than bugs:

- It is not the tab's total memory. Images, the DOM, decoded bitmaps and the compositor are all excluded, and they are usually most of what a tab really costs. Real usage is typically two to four times higher than the number MemTab shows.

- Tabs on the same site share one reading. Chrome puts them in a single renderer process with a single heap, so ten tabs on the same site will show the same value and change together.

- Background tabs update slowly. Chrome throttles timers in hidden tabs to roughly one tick per minute, and may freeze or unload them entirely, so a background tab's colour can be several minutes old.

MemTab is at its best as a leak detector for the tab you are actually using: watch one walk from green to red over an afternoon and you have found something worth investigating. For working out which of forty background tabs to close, Chrome's own Task Manager (Shift+Esc) reads the real per-process figure, and MemTab does not try to replace it.


WHERE IT CAN'T RUN

Chrome does not allow extensions to run on chrome:// pages, the Chrome Web Store, the built-in PDF viewer, or other extensions' pages. Some sites also have a security policy that blocks generated favicons; on those, MemTab can show a small dot in the page corner instead. Click the toolbar icon on any page and it will tell you exactly which case you are in.


OPEN SOURCE

MIT licensed, no dependencies, no obfuscation. Issues and pull requests welcome.

Source and documentation: https://github.com/councilOfNine/memtab
