import { convertFileSrc } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

export const highlightColorMap: Record<string, string> = {
	default: "color-mix(in srgb, var(--color-accent-fg) 40%, transparent)",
	yellow: "rgba(255, 208, 0, 0.4)",
	orange: "rgba(255, 140, 0, 0.4)",
	red: "rgba(255, 60, 60, 0.4)",
	pink: "rgba(255, 105, 180, 0.4)",
	purple: "rgba(164, 108, 244, 0.4)",
	blue: "rgba(67, 138, 243, 0.4)",
	cyan: "rgba(43, 185, 178, 0.4)",
	green: "rgba(77, 177, 88, 0.4)",
};

const alertIcons: Record<string, string> = {
	note: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
	info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
	todo: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check-big"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>',
	tip: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
	important: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-circle"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
	warning: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
	caution: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-octagon-alert"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
	faq: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-help"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
	question: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-help"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
	example: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
};

export function resolvePath(basePath: string, relativePath: string): string {
	if (relativePath.match(/^[a-zA-Z]:/) || relativePath.startsWith("/"))
		return relativePath;
	const parts = basePath.split(/[/\\]/);
	parts.pop();
	for (const p of relativePath.split(/[/\\]/)) {
		if (p === ".") continue;
		if (p === "..") parts.pop();
		else parts.push(p);
	}
	return parts.join("/");
}

export function isYoutubeLink(url: string): boolean {
	return url.includes("youtube.com/watch") || url.includes("youtu.be/");
}

export function getYoutubeId(url: string): string | null {
	const match = url.match(
		/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/,
	);
	return match && match[2].length === 11 ? match[2] : null;
}

function replaceWithYoutubeEmbed(element: Element, videoId: string) {
	const container = element.ownerDocument.createElement("div");
	container.className = "video-container";
	const iframe = element.ownerDocument.createElement("iframe");
	iframe.src = `https://www.youtube.com/embed/${videoId}`;
	iframe.title = "YouTube video player";
	iframe.frameBorder = "0";
	iframe.allow =
		"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
	iframe.allowFullscreen = true;
	container.appendChild(iframe);
	element.replaceWith(container);
}

export function getLanguage(path: string): string {
	if (!path) return "markdown";
	const ext = path.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "js":
		case "jsx":
			return "javascript";
		case "ts":
		case "tsx":
			return "typescript";
		case "html":
			return "html";
		case "css":
			return "css";
		case "json":
			return "json";
		case "md":
		case "markdown":
		case "mdown":
		case "mkd":
			return "markdown";
		default:
			return "plaintext";
	}
}

function processInlineMath(root: Element) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			let curr = node.parentElement;
			while (curr && curr !== root) {
				if (curr.hasAttribute("data-math"))
					return NodeFilter.FILTER_REJECT;
				if (["CODE", "PRE", "SCRIPT", "STYLE"].includes(curr.tagName))
					return NodeFilter.FILTER_REJECT;
				curr = curr.parentElement;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const toReplace: { node: Text; newText: string }[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const text = (node as Text).nodeValue || "";
		if (text.includes("$")) {
			const newText = convertInlineMathDelimiters(text);
			if (newText !== text) toReplace.push({ node: node as Text, newText });
		}
	}
	for (const { node, newText } of toReplace) {
		node.nodeValue = newText;
	}
}

function processDisplayMathBlocks(root: Element, doc: Document) {
	for (const element of Array.from(root.querySelectorAll("p, li"))) {
		const math = extractDisplayMathBlock(element);
		if (!math) continue;

		element.setAttribute("data-math", "display");
		element.setAttribute("data-math-source", math);
		element.replaceChildren(doc.createTextNode(math));
	}
}

function extractDisplayMathBlock(element: Element): string | null {
	let text = "";
	let previousWasBreak = false;

	for (const child of Array.from(element.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			let value = child.nodeValue || "";
			if (previousWasBreak) value = value.replace(/^\n+/, "");
			text += value;
			previousWasBreak = false;
		} else if (
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName === "BR"
		) {
			text += "\n";
			previousWasBreak = true;
		} else {
			return null;
		}
	}

	const trimmed = text.trim();
	if (!trimmed.startsWith("$$") || !trimmed.endsWith("$$")) return null;

	const math = trimmed.slice(2, -2).trim();
	return math ? math : null;
}

function convertInlineMathDelimiters(text: string): string {
	const parts: string[] = [];
	let index = 0;
	// Allows adjacent inline spans like `$a$$b$` without treating `$$` display
	// delimiters as inline math openings.
	let previousDollarAllowsInlineOpen = false;

	while (index < text.length) {
		const char = text[index];
		if (char !== "$") {
			parts.push(char);
			previousDollarAllowsInlineOpen = false;
			index += 1;
			continue;
		}

		if (text[index - 1] !== "\\" && text[index + 1] === "$") {
			const displayEnd = findDisplayMathEnd(text, index + 2);
			if (displayEnd !== -1) {
				parts.push(text.slice(index, displayEnd + 2));
				previousDollarAllowsInlineOpen = true;
				index = displayEnd + 2;
				continue;
			}

			parts.push("$$");
			previousDollarAllowsInlineOpen = false;
			index += 2;
			continue;
		}

		if (
			text[index - 1] === "\\" ||
			(text[index - 1] === "$" && !previousDollarAllowsInlineOpen) ||
			/\s/.test(text[index + 1] || "")
		) {
			parts.push(char);
			previousDollarAllowsInlineOpen = false;
			index += 1;
			continue;
		}

		const end = findInlineMathEnd(text, index + 1);
		if (end === -1) {
			parts.push(char);
			previousDollarAllowsInlineOpen = false;
			index += 1;
			continue;
		}

		parts.push(`\\(${text.slice(index + 1, end)}\\)`);
		index = end + 1;
		previousDollarAllowsInlineOpen = true;
	}

	return parts.join("");
}

function findDisplayMathEnd(text: string, start: number): number {
	for (let index = start; index < text.length - 1; index += 1) {
		if (
			text[index] === "$" &&
			text[index + 1] === "$" &&
			text[index - 1] !== "\\"
		) {
			return index;
		}
	}
	return -1;
}

function findInlineMathEnd(text: string, start: number): number {
	for (let index = start; index < text.length; index += 1) {
		if (text[index] !== "$") continue;
		// Escaped dollars are math content, not closing delimiters.
		if (text[index - 1] === "\\") continue;

		const beforeEnd = text[index - 1] || "";
		const afterEnd = text[index + 1] || "";
		// A following `$` may open an adjacent inline span; the outer loop handles it.
		if (/\s/.test(beforeEnd) || /\d/.test(afterEnd)) return -1;

		return index;
	}
	return -1;
}

function processBlockIds(root: Element, doc: Document) {
	for (const el of Array.from(
		root.querySelectorAll(".block-id, [data-block-id]"),
	)) {
		const rawId =
			el.getAttribute("data-block-id") ||
			(el as HTMLElement).textContent?.replace(/^\^/, "").trim() ||
			"";
		if (!rawId) continue;
		const anchor = doc.createElement("a");
		anchor.id = rawId;
		anchor.className = "block-id-anchor";
		anchor.setAttribute("data-label", rawId);
		anchor.setAttribute("aria-hidden", "true");
		el.replaceWith(anchor);
	}

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (
				[
					"CODE",
					"PRE",
					"SCRIPT",
					"STYLE",
					"H1",
					"H2",
					"H3",
					"H4",
					"H5",
					"H6",
				].includes(parent.tagName)
			)
				return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const blockIdPattern = / \^([a-zA-Z0-9_-]+)\s*$/;
	const nodes: { node: Text; id: string }[] = [];
	let textNode: Node | null;
	while ((textNode = walker.nextNode())) {
		const text = (textNode as Text).nodeValue || "";
		const match = text.match(blockIdPattern);
		if (match) nodes.push({ node: textNode as Text, id: match[1] });
	}

	for (const { node, id } of nodes) {
		const text = node.nodeValue || "";
		const cleanText = text.replace(blockIdPattern, "");
		const anchor = doc.createElement("a");
		anchor.id = id;
		anchor.className = "block-id-anchor";
		anchor.setAttribute("data-label", id);
		anchor.setAttribute("aria-hidden", "true");
		const parent = node.parentNode;
		if (parent) {
			const textBefore = doc.createTextNode(cleanText);
			parent.replaceChild(anchor, node);
			parent.insertBefore(textBefore, anchor);
		}
	}
}

const taskTextBoundaryTags = new Set([
	"ADDRESS",
	"ARTICLE",
	"ASIDE",
	"BLOCKQUOTE",
	"DD",
	"DETAILS",
	"DIALOG",
	"DIV",
	"DL",
	"DT",
	"FIELDSET",
	"FIGCAPTION",
	"FIGURE",
	"FOOTER",
	"FORM",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HEADER",
	"HR",
	"LI",
	"MAIN",
	"NAV",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"TABLE",
	"UL",
]);

function stripLeadingWhitespace(nodes: Node[]) {
	for (let index = 0; index < nodes.length; ) {
		const node = nodes[index];
		if (node.nodeType !== 3) break;

		const trimmed = node.textContent?.replace(/^\s+/, "") || "";
		if (trimmed) {
			node.textContent = trimmed;
			break;
		}
		node.parentNode?.removeChild(node);
		nodes.splice(index, 1);
	}
}

function isWhitespaceText(node: Node) {
	return node.nodeType === 3 && !node.textContent?.trim();
}

function startsWithNode(element: Element, target: Node) {
	const firstContentNode = Array.from(element.childNodes).find(
		(node) => !isWhitespaceText(node),
	);
	return firstContentNode === target;
}

function isTaskCheckbox(input: Element, li: Element) {
	const looksRenderedByTaskList =
		input.hasAttribute("data-task-checkbox") ||
		li.classList.contains("task-list-item");
	if (!looksRenderedByTaskList) return false;

	const inputParent = input.parentElement;
	if (inputParent === li) {
		return startsWithNode(li, input);
	}

	return (
		inputParent?.tagName === "P" &&
		inputParent.parentElement === li &&
		startsWithNode(li, inputParent) &&
		startsWithNode(inputParent, input)
	);
}

function processTaskItems(root: Element) {
	for (const input of Array.from(
		root.querySelectorAll('li input[type="checkbox"]'),
	)) {
		const li = input.closest("li");
		if (!li) continue;
		if (!isTaskCheckbox(input, li)) continue;

		input.setAttribute("data-task-checkbox", "");
		input.removeAttribute("disabled");
		(input as HTMLInputElement).style.cursor = "pointer";

		const inputParagraph = input.parentElement;
		if (inputParagraph?.tagName === "P" && inputParagraph.parentElement === li) {
			li.insertBefore(input, inputParagraph);
		}

		const nodes = Array.from(li.childNodes);
		const inputIdx = nodes.indexOf(input);
		if (inputIdx === -1) continue;
		const afterInput = nodes.slice(inputIdx + 1);

		const inlineNodes: Node[] = [];
		let paragraphNode: Element | null = null;
		for (const n of afterInput) {
			if (n.nodeType === 3 && !n.textContent?.trim()) {
				inlineNodes.push(n);
				continue;
			}

			if (n.nodeType === 1 && taskTextBoundaryTags.has((n as Element).tagName)) {
				const onlyLeadingWhitespace = inlineNodes.every(
					(node) => node.nodeType === 3 && !node.textContent?.trim(),
				);
				if ((n as Element).tagName === "P" && onlyLeadingWhitespace) {
					paragraphNode = n as Element;
				}
				break;
			}
			inlineNodes.push(n);
		}

		const hasInlineText = inlineNodes.some(
			(n) => n.nodeType !== 3 || n.textContent?.trim(),
		);
		if (paragraphNode) {
			stripLeadingWhitespace(inlineNodes);
			const paragraphChildren = Array.from(paragraphNode.childNodes);
			const hasParagraphText = paragraphChildren.some(
				(n) => n.nodeType !== 3 || n.textContent?.trim(),
			);
			if (!hasParagraphText) {
				paragraphNode.remove();
			} else {
				stripLeadingWhitespace(paragraphChildren);
				const wrapper = root.ownerDocument!.createElement("span");
				wrapper.className = "task-text";
				for (const n of paragraphChildren) wrapper.appendChild(n);
				paragraphNode.replaceWith(wrapper);
			}
		} else if (hasInlineText) {
			const insertBeforeNode = afterInput[inlineNodes.length] || null;
			stripLeadingWhitespace(inlineNodes);
			const wrapper = root.ownerDocument!.createElement("span");
			wrapper.className = "task-text";
			for (const n of inlineNodes) wrapper.appendChild(n);
			li.insertBefore(wrapper, insertBeforeNode);
		} else {
			stripLeadingWhitespace(inlineNodes);
		}

		if ((input as HTMLInputElement).checked) {
			li.classList.add("task-done");
		}
	}
}

export function processMarkdownHtml(
	html: string,
	filePath: string,
	collapsedHeaders: Set<string>,
): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");

	for (const img of doc.querySelectorAll("img")) {
		const src = img.getAttribute("src");
		let finalSrc = src;
		if (src && !src.startsWith("http") && !src.startsWith("data:")) {
			try {
				const decodedSrc = decodeURIComponent(src);
				finalSrc = convertFileSrc(resolvePath(filePath, decodedSrc));
				img.setAttribute("src", finalSrc);
			} catch (e) {
				console.error("Failed to decode/resolve image src:", src, e);
			}
		}

		if (src) {
			const ext = src.split(".").pop()?.toLowerCase();
			const isVideo = ["mp4", "webm", "ogg", "mov"].includes(ext || "");
			const isAudio = ["mp3", "wav", "aac", "flac", "m4a"].includes(
				ext || "",
			);

			if (isVideo || isAudio) {
				const media = doc.createElement(isVideo ? "video" : "audio");
				media.setAttribute("controls", "");
				media.setAttribute("src", finalSrc || "");
				media.style.maxWidth = "100%";

				if (img.hasAttribute("width"))
					media.setAttribute("width", img.getAttribute("width")!);
				if (img.hasAttribute("height"))
					media.setAttribute("height", img.getAttribute("height")!);
				if (img.hasAttribute("alt"))
					media.setAttribute("aria-label", img.getAttribute("alt")!);
				if (img.hasAttribute("title"))
					media.setAttribute("title", img.getAttribute("title")!);

				img.replaceWith(media);
				continue;
			}

			if (isYoutubeLink(src)) {
				const videoId = getYoutubeId(src);
				if (videoId) replaceWithYoutubeEmbed(img, videoId);
			}
		}
	}

	for (const a of doc.querySelectorAll("a")) {
		const href = a.getAttribute("href");
		if (href && isYoutubeLink(href)) {
			const parent = a.parentElement;
			if (
				parent &&
				(parent.tagName === "P" || parent.tagName === "DIV") &&
				parent.childNodes.length === 1
			) {
				const videoId = getYoutubeId(href);
				if (videoId) replaceWithYoutubeEmbed(a, videoId);
			}
		}
	}

	const stripLeadingBreaks = (node: Node) => {
		const brs = (node as Element).querySelectorAll("br");
		for (const br of Array.from(brs)) {
			// If the BR is the first meaningful node in its parent or overall block
			let prev = br.previousSibling;
			let isLeading = true;
			while (prev) {
				if (prev.nodeType === 3 && prev.textContent?.replace(/\xA0|\s|&nbsp;/g, "").trim()) {
					isLeading = false;
					break;
				} else if (prev.nodeType === 1) {
					isLeading = false;
					break;
				}
				prev = prev.previousSibling;
			}
			if (isLeading) {
				br.parentElement?.removeChild(br);
			}
		}

		// Also clean up leading empty text nodes and paragraphs
		while (node.firstChild) {
			const child = node.firstChild;
			if (child.nodeType === 3 && child.textContent?.replace(/\xA0|\s|&nbsp;/g, "").trim() === "") {
				child.parentElement?.removeChild(child);
			} else if (child.nodeType === 1 && (child as Element).tagName === "P" && (child as Element).innerHTML.replace(/\xA0|\s|&nbsp;/g, "").trim() === "") {
				child.parentElement?.removeChild(child);
			} else {
				break;
			}
		}
	};

	// parse callouts
	for (const bq of Array.from(doc.querySelectorAll("blockquote"))) {
		const walker = doc.createTreeWalker(bq, NodeFilter.SHOW_TEXT);
		let textNode: Text | null = null;
		let matchResult: RegExpMatchArray | null = null;
		
		let curr: Node | null;
		while (curr = walker.nextNode()) {
			const m = curr.nodeValue?.match(/^\s*\[!([a-zA-Z0-9_\-]+)\]([+-]?)\s*/i);
			if (m) {
				textNode = curr as Text;
				matchResult = m;
				break;
			}
		}

		if (textNode && matchResult) {
			const type = matchResult[1].toLowerCase();
			const fold = matchResult[2] || "";
			const isFoldable = fold === "+" || fold === "-";
			
			textNode.nodeValue = textNode.nodeValue!.slice(matchResult[0].length);

			const titleNodes: Node[] = [];
			let currentLineNode: Node | null = textNode;
			while (currentLineNode) {
				if (currentLineNode.nodeType === 1 && (currentLineNode as Element).tagName === "BR") {
					const br = currentLineNode;
					currentLineNode = br.nextSibling;
					br.parentElement?.removeChild(br);
					break;
				}
				const next: Node | null = currentLineNode.nextSibling;
				titleNodes.push(currentLineNode);
				currentLineNode = next;
			}

			const container = doc.createElement("div");
			container.className = `markdown-alert markdown-alert-${type}${isFoldable ? ' callout-foldable' : ''}`;
			
			const titleEl = doc.createElement("p");
			titleEl.className = "markdown-alert-title";
			if (isFoldable) titleEl.classList.add("callout-toggle");

			const titleInner = doc.createElement("span");
			titleInner.className = "callout-title-inner";
			for (const tn of titleNodes) titleInner.appendChild(tn);
			
			// Restore default title if empty
			if (titleInner.textContent?.trim() === "") {
				titleInner.textContent = type.charAt(0).toUpperCase() + type.slice(1);
			}
			
			// Omit rendering any stray <br> tags in the title
			for (const br of Array.from(titleInner.querySelectorAll("br"))) {
				br.parentElement?.removeChild(br);
			}

			const svgIconHtml = alertIcons[type] || "";
			if (svgIconHtml) {
				const temp = doc.createElement("div");
				temp.innerHTML = svgIconHtml;
				if (temp.firstChild) titleEl.appendChild(temp.firstChild);
			}
			titleEl.appendChild(titleInner);

			if (isFoldable) {
				const chevron = doc.createElement("div");
				chevron.innerHTML = `<svg class="callout-fold-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
				titleEl.appendChild(chevron.firstChild!);
			}
			container.appendChild(titleEl);

			const contentWrapper = doc.createElement("div");
			contentWrapper.className = "markdown-alert-content";
			const contentInner = doc.createElement("div");
			contentInner.className = "content-inner";
			contentWrapper.appendChild(contentInner);

			while (bq.firstChild) {
				contentInner.appendChild(bq.firstChild);
			}

			stripLeadingBreaks(contentInner);
			
			while (contentInner.lastChild) {
				const child = contentInner.lastChild;
				if (child.nodeType === 3 && child.textContent?.trim() === "") child.parentElement?.removeChild(child);
				else if (child.nodeType === 1 && (child as Element).tagName === "P" && (child as Element).innerHTML.trim() === "") child.parentElement?.removeChild(child);
				else break;
			}

			if (contentInner.childNodes.length === 0) {
				container.classList.add("callout-title-only");
			} else {
				if (fold === "-") {
					contentWrapper.classList.add("is-collapsed");
					container.classList.add("is-collapsed");
				}
				container.appendChild(contentWrapper);
			}
			bq.replaceWith(container);
		}
	}

	processDisplayMathBlocks(doc.body, doc);
	processBlockIds(doc.body, doc);
	processTaskItems(doc.body);
	processInlineMath(doc.body);

	const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));
	for (const h of headings) {
		const chevron = doc.createElement("span");
		chevron.className = "header-fold-icon";
		chevron.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
		h.insertBefore(chevron, h.firstChild);
		h.classList.add("foldable-header");

		const wrapper = doc.createElement("div");
		wrapper.className = "foldable-content-wrapper";
		const inner = doc.createElement("div");
		inner.className = "content-inner";
		wrapper.appendChild(inner);

		let current = h.nextElementSibling;
		const level = parseInt(h.tagName[1], 10);
		while (current) {
			const isHeader = /^H[1-6]$/.test(current.tagName);
			if (isHeader) {
				const nextLevel = parseInt(current.tagName[1], 10);
				if (nextLevel <= level) break;
			}
			const next = current.nextElementSibling;
			inner.appendChild(current);
			current = next;
		}
		if (h.parentNode) h.parentNode.insertBefore(wrapper, h.nextSibling);

		const mappingId = "wrap-" + Math.random().toString(36).substr(2, 9);
		h.setAttribute("data-fold-target", mappingId);
		wrapper.id = mappingId;

		const key = h.id || h.textContent?.trim() || "";
		if (collapsedHeaders.has(key)) {
			h.classList.add("is-collapsed");
			wrapper.classList.add("is-collapsed");
		}
	}

	// Clean up empty paragraphs that might be leftovers from blank lines
	Array.from(doc.querySelectorAll("p")).forEach((p) => {
		if (p.innerHTML.replace(/&nbsp;|\s/g, "").trim() === "") {
			p.remove();
		}
	});

	return doc.body.innerHTML;
}

export async function renderRichContent(
	markdownBody: HTMLElement,
	hljs: any,
	katex: any,
	renderMathInElement: any,
	mermaid: any,
	theme: string,
	invoke: (cmd: string, args?: any) => Promise<any>,
) {
	if (!hljs || !renderMathInElement || !mermaid) return;

	const isSystemDark = window.matchMedia(
		"(prefers-color-scheme: dark)",
	).matches;
	const datasetThemeType = document.documentElement.dataset.themeType;
	const isDark =
		datasetThemeType === "dark" ||
		theme === "dark" ||
		(theme === "system" && isSystemDark);
	const effectiveTheme = isDark ? "dark" : "neutral";
	mermaid.initialize({ startOnLoad: false, theme: effectiveTheme });

	const codeBlocks = Array.from(markdownBody.querySelectorAll("pre code"));
	for (const block of codeBlocks) {
		const codeEl = block as HTMLElement;
		const preEl = codeEl.parentElement as HTMLPreElement;

		if (codeEl.classList.contains("language-mermaid")) {
			try {
				const mermaidCode = codeEl.textContent || "";
				const id = `mermaid-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
				const { svg } = await mermaid.render(id, mermaidCode);
				const container = document.createElement("div");
				container.className = "mermaid-diagram";
				container.innerHTML = DOMPurify.sanitize(svg, {
					ADD_TAGS: ["foreignObject"],
					ADD_ATTR: ["dominant-baseline", "text-anchor"],
				});
				preEl.replaceWith(container);
			} catch (error) {
				console.error("Failed to render Mermaid diagram:", error);
				const errorDiv = document.createElement("div");
				errorDiv.className = "mermaid-error";
				errorDiv.style.color = "red";
				errorDiv.style.padding = "1em";
				errorDiv.textContent = `Error rendering Mermaid diagram: ${error}`;
				preEl.replaceWith(errorDiv);
			}
			continue;
		}

		const hasExplicitLang = Array.from(codeEl.classList).some((c) =>
			c.startsWith("language-"),
		);

		if (hasExplicitLang) {
			hljs.highlightElement(codeEl);
		}

		const langClass = Array.from(codeEl.classList).find((c) =>
			c.startsWith("language-"),
		);

		if (preEl && preEl.tagName === "PRE") {
			preEl.querySelectorAll(".lang-label").forEach((l) => l.remove());
			const codeContent = codeEl.textContent || "";
			const existingWrapper = preEl.parentElement?.classList.contains(
				"code-block-shell",
			)
				? (preEl.parentElement as HTMLDivElement)
				: null;
			existingWrapper
				?.querySelectorAll(":scope > .lang-label")
				.forEach((l) => l.remove());

			const wrapper = existingWrapper ?? document.createElement("div");
			if (!existingWrapper) {
				wrapper.className = "code-block-shell";
				preEl.replaceWith(wrapper);
				wrapper.appendChild(preEl);
			}

			const copyCode = () => {
				const codeToCopy = codeContent.replace(/\n$/, "");
				invoke("clipboard_write_text", { text: codeToCopy })
					.then(() => {
						const originalContent = label.innerHTML;
						label.innerHTML = "Copied!";
						label.classList.add("copied");
						setTimeout(() => {
							label.innerHTML = originalContent;
							label.classList.remove("copied");
						}, 1500);
					})
					.catch((err) => {
						console.error("Failed to copy code:", err);
					});
			};

			const label = document.createElement("button");
			label.className = "lang-label";
			label.title = "Click to copy code";
			label.onclick = copyCode;

			if (hasExplicitLang && langClass) {
				label.textContent = langClass.replace("language-", "");
				wrapper.appendChild(label);
			} else {
				label.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
				wrapper.appendChild(label);
			}
		}
	}

	if (katex) {
		const mathElements = markdownBody.querySelectorAll("[data-math]");
		for (const el of Array.from(mathElements)) {
			const isDisplay = el.getAttribute("data-math") === "display";
			const mathSource = el.getAttribute("data-math-source") || el.textContent || "";
			try {
				katex.render(mathSource, el as HTMLElement, {
					displayMode: isDisplay,
					throwOnError: false,
				});
			} catch (e) {
				console.error("KaTeX rendering error:", e);
			}
		}
	}

	if (renderMathInElement) {
		renderMathInElement(markdownBody, {
			delimiters: [
				{ left: "$$", right: "$$", display: true },
				{ left: "\\(", right: "\\)", display: false },
				{ left: "\\[", right: "\\]", display: true },
			],
			throwOnError: false,
		});
	}
}
