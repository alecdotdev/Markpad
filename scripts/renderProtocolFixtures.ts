/**
 * Markdown input → `convert_markdown` output, captured from a real comrak run.
 *
 * These are INPUTS, not expected values: `renderProtocol.test.ts` feeds the
 * `html` of each case to the frontend's `processMarkdownHtml` and asserts what
 * the frontend does with it. Nothing here re-asserts comrak's own behaviour —
 * that is `src-tauri/src/lib.rs`'s `mod tests` job, and it already covers it.
 *
 * Provenance: produced by running comrak 0.18 with the exact
 * `ComrakOptions`/`ComrakExtensionOptions` of `convert_markdown`, followed by
 * verbatim copies of `protect_display_math_underscores` and
 * `annotate_task_checkboxes`. The capture harness was validated by reproducing,
 * byte for byte, the HTML literals asserted in the Rust test module (for
 * example `task_list_checkbox_is_emitted_at_the_start_of_its_list_item`).
 * The wikilink/embed/autolink pre-passes are no-ops on every input below.
 *
 * To refresh after a comrak upgrade or a renderer change, re-run the pipeline
 * over `markdown` and replace `html`. Do not hand-edit `html`: a fixture that
 * no longer matches the renderer makes every assertion here a lie.
 */

export type RenderFixture = {
	/** Markdown handed to `convert_markdown`. */
	markdown: string;
	/** Exactly what `convert_markdown` returned. */
	html: string;
};

export const renderFixtures = {
	// --- protocol 1 — task-list markers and source positions ---
	taskSimple: {
		markdown: "- [ ] open task\n- [x] completed task\n",
		html: "<ul data-sourcepos=\"1:1-2:20\">\n<li data-sourcepos=\"1:1-1:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> open task</li>\n<li data-sourcepos=\"2:1-2:20\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> completed task</li>\n</ul>\n",
	},
	taskNested: {
		markdown: "- [ ] parent\n  - [x] nested\n",
		html: "<ul data-sourcepos=\"1:1-2:14\">\n<li data-sourcepos=\"1:1-2:14\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> parent\n<ul data-sourcepos=\"2:3-2:14\">\n<li data-sourcepos=\"2:3-2:14\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> nested</li>\n</ul>\n</li>\n</ul>\n",
	},
	taskQuoted: {
		markdown: "> - [ ] quoted task\n",
		html: "<blockquote data-sourcepos=\"1:1-1:19\">\n<ul data-sourcepos=\"1:3-1:19\">\n<li data-sourcepos=\"1:3-1:19\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> quoted task</li>\n</ul>\n</blockquote>\n",
	},
	taskOrdered: {
		markdown: "1. [ ] ordered open\n2. [x] ordered done\n",
		html: "<ol data-sourcepos=\"1:1-2:19\">\n<li data-sourcepos=\"1:1-1:19\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> ordered open</li>\n<li data-sourcepos=\"2:1-2:19\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> ordered done</li>\n</ol>\n",
	},
	taskSurrounded: {
		markdown: "# Title\n\nIntro paragraph.\n\n- [ ] after prose\n\nTrailing prose.\n\n- [x] after blank\n",
		html: "<h1 data-sourcepos=\"1:1-1:7\"><a href=\"#title\" aria-hidden=\"true\" class=\"anchor\" id=\"title\"></a>Title</h1>\n<p data-sourcepos=\"3:1-3:16\">Intro paragraph.</p>\n<ul data-sourcepos=\"5:1-6:0\">\n<li data-sourcepos=\"5:1-6:0\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> after prose</li>\n</ul>\n<p data-sourcepos=\"7:1-7:15\">Trailing prose.</p>\n<ul data-sourcepos=\"9:1-9:17\">\n<li data-sourcepos=\"9:1-9:17\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> after blank</li>\n</ul>\n",
	},
	taskCrlf: {
		markdown: "- [ ] crlf open\r\n- [x] crlf done\r\n",
		html: "<ul data-sourcepos=\"1:1-2:15\">\n<li data-sourcepos=\"1:1-1:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> crlf open</li>\n<li data-sourcepos=\"2:1-2:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> crlf done</li>\n</ul>\n",
	},
	taskLoose: {
		markdown: "- [ ] loose one\n\n- [x] loose two\n",
		html: "<ul data-sourcepos=\"1:1-3:15\">\n<li data-sourcepos=\"1:1-2:0\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> \n<p data-sourcepos=\"1:7-1:15\">loose one</p>\n</li>\n<li data-sourcepos=\"3:1-3:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> \n<p data-sourcepos=\"3:7-3:15\">loose two</p>\n</li>\n</ul>\n",
	},
	taskContinuation: {
		markdown: "- [ ] first line\n  continued line\n- [x] second task\n",
		html: "<ul data-sourcepos=\"1:1-3:17\">\n<li data-sourcepos=\"1:1-2:16\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> first line<br data-sourcepos=\"1:17-1:17\" />\ncontinued line</li>\n<li data-sourcepos=\"3:1-3:17\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> second task</li>\n</ul>\n",
	},
	taskParenOrdered: {
		markdown: "1) [ ] paren marker\n",
		html: "<ol data-sourcepos=\"1:1-1:19\">\n<li data-sourcepos=\"1:1-1:19\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> paren marker</li>\n</ol>\n",
	},
	taskStarPlus: {
		markdown: "* [ ] star marker\n+ [x] plus marker\n",
		html: "<ul data-sourcepos=\"1:1-1:17\">\n<li data-sourcepos=\"1:1-1:17\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> star marker</li>\n</ul>\n<ul data-sourcepos=\"2:1-2:17\">\n<li data-sourcepos=\"2:1-2:17\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> plus marker</li>\n</ul>\n",
	},
	// --- protocol 2 — $$…$$ underscore protection (issue #174 shapes) ---
	mathBracedSubscripts: {
		markdown: "$$\\bar{b}_{1} + \\bar{b}_{2}$$\n",
		html: "<p data-sourcepos=\"1:1-1:33\">$$\\bar{b}_{1} + \\bar{b}_{2}$$</p>\n",
	},
	mathPlainSubscripts: {
		markdown: "$$x_1 + y_2 + z_3$$\n",
		html: "<p data-sourcepos=\"1:1-1:25\">$$x_1 + y_2 + z_3$$</p>\n",
	},
	mathBlockOwnLines: {
		markdown: "$$\na_i = b_i + c_i\n$$\n",
		html: "<p data-sourcepos=\"1:1-3:2\">$$<br data-sourcepos=\"1:3-1:3\" />\na_i = b_i + c_i<br data-sourcepos=\"2:22-2:22\" />\n$$</p>\n",
	},
	mathTwoBlocksOneLine: {
		markdown: "before $$a_1$$ middle $$b_2$$ after\n",
		html: "<p data-sourcepos=\"1:1-1:39\">before $$a_1$$ middle $$b_2$$ after</p>\n",
	},
	mathEscapedUnderscore: {
		markdown: "$$x\\_y_z$$\n",
		html: "<p data-sourcepos=\"1:1-1:14\">$$x\\_y_z$$</p>\n",
	},
	mathEmphasisOutsideStillWorks: {
		markdown: "_emphasis_ then $$p_1 + q_2$$ then _more_\n",
		html: "<p data-sourcepos=\"1:1-1:45\"><em data-sourcepos=\"1:1-1:10\">emphasis</em> then $$p_1 + q_2$$ then <em data-sourcepos=\"1:40-1:45\">more</em></p>\n",
	},
	mathInsideListItem: {
		markdown: "- $$u_1 + v_2$$\n",
		html: "<ul data-sourcepos=\"1:1-1:19\">\n<li data-sourcepos=\"1:1-1:19\">$$u_1 + v_2$$</li>\n</ul>\n",
	},
	// --- protocol 3 — heading ids and fold anchors (#371) ---
	headingPunctuation: {
		markdown: "## Hello, World!\n",
		html: "<h2 data-sourcepos=\"1:1-1:16\"><a href=\"#hello-world\" aria-hidden=\"true\" class=\"anchor\" id=\"hello-world\"></a>Hello, World!</h2>\n",
	},
	headingDuplicates: {
		markdown: "# Title\n\nfirst\n\n# Title\n\nsecond\n\n# Title\n\nthird\n",
		html: "<h1 data-sourcepos=\"1:1-1:7\"><a href=\"#title\" aria-hidden=\"true\" class=\"anchor\" id=\"title\"></a>Title</h1>\n<p data-sourcepos=\"3:1-3:5\">first</p>\n<h1 data-sourcepos=\"5:1-5:7\"><a href=\"#title-1\" aria-hidden=\"true\" class=\"anchor\" id=\"title-1\"></a>Title</h1>\n<p data-sourcepos=\"7:1-7:6\">second</p>\n<h1 data-sourcepos=\"9:1-9:7\"><a href=\"#title-2\" aria-hidden=\"true\" class=\"anchor\" id=\"title-2\"></a>Title</h1>\n<p data-sourcepos=\"11:1-11:5\">third</p>\n",
	},
	headingChinese: {
		markdown: "## 中文标题\n",
		html: "<h2 data-sourcepos=\"1:1-1:15\"><a href=\"#中文标题\" aria-hidden=\"true\" class=\"anchor\" id=\"中文标题\"></a>中文标题</h2>\n",
	},
	headingNumericDot: {
		markdown: "## 1. 概述\n",
		html: "<h2 data-sourcepos=\"1:1-1:12\"><a href=\"#1-概述\" aria-hidden=\"true\" class=\"anchor\" id=\"1-概述\"></a>1. 概述</h2>\n",
	},
	headingApostrophe: {
		markdown: "## Ticks aren't in\n",
		html: "<h2 data-sourcepos=\"1:1-1:18\"><a href=\"#ticks-arent-in\" aria-hidden=\"true\" class=\"anchor\" id=\"ticks-arent-in\"></a>Ticks aren't in</h2>\n",
	},
	headingUnderscore: {
		markdown: "## under_score here\n",
		html: "<h2 data-sourcepos=\"1:1-1:19\"><a href=\"#under_score-here\" aria-hidden=\"true\" class=\"anchor\" id=\"under_score-here\"></a>under_score here</h2>\n",
	},
	headingNesting: {
		markdown: "# A\n\nbody a\n\n## B\n\nbody b\n\n# C\n\nbody c\n",
		html: "<h1 data-sourcepos=\"1:1-1:3\"><a href=\"#a\" aria-hidden=\"true\" class=\"anchor\" id=\"a\"></a>A</h1>\n<p data-sourcepos=\"3:1-3:6\">body a</p>\n<h2 data-sourcepos=\"5:1-5:4\"><a href=\"#b\" aria-hidden=\"true\" class=\"anchor\" id=\"b\"></a>B</h2>\n<p data-sourcepos=\"7:1-7:6\">body b</p>\n<h1 data-sourcepos=\"9:1-9:3\"><a href=\"#c\" aria-hidden=\"true\" class=\"anchor\" id=\"c\"></a>C</h1>\n<p data-sourcepos=\"11:1-11:6\">body c</p>\n",
	},
	// --- protocol 4 — raw HTML checkboxes are not markdown tasks (#319) ---
	rawCheckboxListItem: {
		markdown: "- <input type=\"checkbox\" /> raw control\n",
		html: "<ul data-sourcepos=\"1:1-1:39\">\n<li data-sourcepos=\"1:1-1:39\"><input type=\"checkbox\" /> raw control</li>\n</ul>\n",
	},
	rawCheckboxDisabled: {
		markdown: "- <input type=\"checkbox\" disabled=\"\" /> raw disabled control\n",
		html: "<ul data-sourcepos=\"1:1-1:60\">\n<li data-sourcepos=\"1:1-1:60\"><input type=\"checkbox\" disabled=\"\" /> raw disabled control</li>\n</ul>\n",
	},
	rawCheckboxHtmlList: {
		markdown: "<ul>\n<li><input type=\"checkbox\" disabled=\"\" /> hand written</li>\n</ul>\n",
		html: "<ul>\n<li><input type=\"checkbox\" disabled=\"\" /> hand written</li>\n</ul>\n",
	},
	rawCheckboxMixedWithTask: {
		markdown: "- [ ] real task\n- <input type=\"checkbox\" /> raw control\n",
		html: "<ul data-sourcepos=\"1:1-2:39\">\n<li data-sourcepos=\"1:1-1:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> real task</li>\n<li data-sourcepos=\"2:1-2:39\"><input type=\"checkbox\" /> raw control</li>\n</ul>\n",
	},
	rawCheckboxParagraph: {
		markdown: "A paragraph with <input type=\"checkbox\" /> inline.\n",
		html: "<p data-sourcepos=\"1:1-1:50\">A paragraph with <input type=\"checkbox\" /> inline.</p>\n",
	},
} as const satisfies Record<string, RenderFixture>;

export type RenderFixtureName = keyof typeof renderFixtures;
