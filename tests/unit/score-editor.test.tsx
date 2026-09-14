// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import { ScoreEditor } from '../../app/frontend/ScoreEditor';
import { demo } from '../../app/frontend/music/score';
import { readMusicXml } from '../../app/frontend/music/musicxml';

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('XMLSerializer', XMLSerializer);

describe('score editor controls', () => {
  afterEach(cleanup);

  it('edits native notes and measures and reports invalid entries', () => {
    const onApply = vi.fn();
    render(<ScoreEditor score={demo} preview={null} onApplyNative={onApply} onApplyImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Score title'), { target: { value: 'Edited demo' } });
    fireEvent.change(screen.getByLabelText('Score tempo'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Measure count'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Measure count'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Measure count'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Measure count'), { target: { value: '2' } });
    const fret = screen.getByLabelText('Measure 1 beat 1 string 1 fret');
    fireEvent.change(fret, { target: { value: '23' } });
    expect(screen.getByRole('alert').textContent).toContain('0 to 22');
    fireEvent.change(fret, { target: { value: '4' } });
    fireEvent.change(fret, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply edits' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: 'Edited demo', tempo: 110, measures: expect.any(Array) }));
  });

  it('edits imported metadata, tuning, notes, and techniques', () => {
    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const preview = readMusicXml(source, 'edit.xml');
    const onApply = vi.fn();
    render(<ScoreEditor score={demo} preview={preview} onApplyNative={vi.fn()} onApplyImported={onApply} />);
    fireEvent.change(screen.getByLabelText('Score title'), { target: { value: 'Edited import' } });
    fireEvent.change(screen.getByLabelText('Score tempo'), { target: { value: '130' } });
    fireEvent.change(screen.getByLabelText('Measure count'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Tuning string 1'), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText('Lyrics and chords'), { target: { value: 'VERSE\nEdited' } });
    fireEvent.change(screen.getByLabelText('Sections and annotations'), { target: { value: 'Verse\nHigh solo' } });
    fireEvent.change(screen.getByLabelText('Chord names'), { target: { value: 'Dm' } });
    fireEvent.change(screen.getByLabelText('Imported note 0 fret'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Imported note 0 string'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Imported note 0 technique'), { target: { value: 'thumb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply edits' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: 'Edited import', tempo: 130, measureCount: 2, lyricsSection: 'VERSE\nEdited' }));
  });

  it('shows callback failures from both editor paths', () => {
    const native = vi.fn(() => { throw new Error('native apply failed'); });
    const nativeView = render(<ScoreEditor score={demo} preview={null} onApplyNative={native} onApplyImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply edits' }));
    expect(screen.getByRole('alert').textContent).toContain('native apply failed');
    nativeView.unmount();

    const source = fs.readFileSync('tests/fixtures/techniques.musicxml', 'utf8');
    const preview = readMusicXml(source, 'edit.xml');
    render(<ScoreEditor score={demo} preview={preview} onApplyNative={vi.fn()} onApplyImported={() => { throw new Error('import apply failed'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply edits' }));
    expect(screen.getByRole('alert').textContent).toContain('import apply failed');
  });
});
