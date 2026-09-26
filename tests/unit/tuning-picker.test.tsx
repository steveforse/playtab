// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TuningPicker, tuningPreset } from '../../app/frontend/editor/TuningPicker';

afterEach(cleanup);
const OPEN_G = [62, 59, 55, 50, 67];
const DOUBLE_C = [62, 60, 55, 48, 67];

describe('tuning picker presets', () => {
  it('names capo presets only at their capo and plain presets at any capo', () => {
    expect(tuningPreset(DOUBLE_C, 2)?.name).toBe('Double D');
    expect(tuningPreset(DOUBLE_C, 0)?.name).toBe('Double C');
    expect(tuningPreset(OPEN_G, 2)?.name).toBe('Open A');
    expect(tuningPreset(OPEN_G, 3)?.name).toBe('Open G');
    expect(tuningPreset(DOUBLE_C)?.name).toBe('Double C');
  });

  it('sets a capo preset’s capo and removes it again when leaving for a plain preset', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TuningPicker tuning={OPEN_G} capo={0} onChange={onChange} />);
    const menu = screen.getByLabelText<HTMLSelectElement>('Tuning preset');
    expect(menu.value).toBe('Open G');
    expect(screen.getByRole('option', { name: 'Double D — aDADE (Double C, capo 2)' })).toBeTruthy();
    fireEvent.change(menu, { target: { value: 'Double D' } });
    expect(onChange).toHaveBeenLastCalledWith(DOUBLE_C, 2);
    rerender(<TuningPicker tuning={DOUBLE_C} capo={2} onChange={onChange} />);
    expect(menu.value).toBe('Double D');
    fireEvent.change(menu, { target: { value: 'Open G' } });
    expect(onChange).toHaveBeenLastCalledWith(OPEN_G, 0);
    rerender(<TuningPicker tuning={OPEN_G} capo={3} onChange={onChange} />);
    expect(menu.value).toBe('Open G');
    fireEvent.change(menu, { target: { value: 'Sawmill (G modal)' } });
    expect(onChange).toHaveBeenLastCalledWith([62, 60, 55, 50, 67], 3);
  });

  it('offers only plain presets where there is no capo', () => {
    const onChange = vi.fn();
    render(<TuningPicker label="new score" tuning={OPEN_G} onChange={onChange} />);
    expect(screen.queryByRole('option', { name: /Double D/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('New score tuning preset'), { target: { value: 'Double C' } });
    expect(onChange).toHaveBeenLastCalledWith(DOUBLE_C, undefined);
  });
});
