// Shared setup for the editing-engine unit tests: an XML DOM for Node and
// the synthetic rich-source fixture (no private arrangement content).
import { vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

export const rich = fs.readFileSync('tests/fixtures/editor-rich.musicxml', 'utf8');
