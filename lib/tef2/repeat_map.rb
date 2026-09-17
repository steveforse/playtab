# frozen_string_literal: true

module Tef2
  # Decodes the verified subset of the TEF2 repeat table into MusicXML
  # ending/repeat records consumed by FullMusicxmlBuilder.
  #
  # Verified against TefView and the printed PDFs in the private Brainjo
  # corpus (2026-09-16):
  #
  # * Entries sharing a start describe a first/second ending. For a start
  #   s and lengths L1 > L2: the first pass plays measures s..L1 (the first
  #   ending covers measure L1) and the second pass plays s..L2, then
  #   measure L1+1 (the second ending). The section start is 1-based: the
  #   printed forward repeat sign sits at measure s (corpus-verified for
  #   s = 1, 9, and 10).
  #
  # * A single entry (s, e) with e < the measure count is a plain repeat of
  #   measures s+1..e: the forward sign sits after measure s and the
  #   backward sign after measure e. Verified for snowdrop (17, 25) =
  #   repeat 18-25 (TefView, with the forward sign also printed at m18) and
  #   confirmed by printed repeat signs for bar-b-que (1, 9) = 2-9,
  #   big eyed rabbit (12, 16) = 13-16, and flying indian (10, 18) = 11-18.
  #
  # * A single entry whose end equals the measure count is a final-section
  #   marker, not a repeat (snowdrop's (18, 41) has no corresponding repeat
  #   in TefView; the same shape appears across the corpus).
  #
  # Anything else (degenerate or out-of-bounds entries, same-start groups
  # of three or more) is not decoded; it remains raw repeat-map metadata
  # with a visible import warning.
  module RepeatMap
    # Returns [records, warnings, decoded_entry_count]. Records use the
    # same shape as TableditV3Parser ending records (0-based measure
    # indexes) plus the :span and :repeat fields understood by
    # FullMusicxmlBuilder. Plain repeats use type: :repeat with
    # is_open/is_close and ending_number 0: the open record marks the left
    # barline of the first repeated measure, the close record the right
    # barline of the last repeated measure.
    def self.decode(repeats, measure_count)
      records = []
      warnings = []
      decoded = 0

      repeats.group_by { |entry| entry[:start] }.each do |start, entries|
        case entries.size
        when 1
          record = decode_single_repeat(entries.first, measure_count, warnings)
          if record
            records.concat(record)
            decoded += 1
          end
        when 2
          result = decode_volta(start, entries, measure_count, warnings)
          if result
            records.concat(result)
            decoded += 2
          end
        else
          warnings << "TEF2 repeat table has #{entries.size} entries with the same start (#{start}); no ending was decoded."
        end
      end

      records.sort_by! { |record| record[:measure] }
      [ records, warnings, decoded ]
    end

    # A single repeat entry (s, e): repeat of measures s+1..e. Returns the
    # two barline records, or nil when the entry is not a plain repeat.
    def self.decode_single_repeat(entry, measure_count, warnings)
      start = entry[:start]
      end_measure = entry[:length]
      return nil if start.zero? && end_measure.zero?

      # Final-section markers (end == measure count) are not repeats.
      return nil if end_measure == measure_count
      unless start.positive? && start + 1 <= end_measure && end_measure <= measure_count
        warnings << "TEF2 repeat table entry (#{start}, #{end_measure}) was not decoded; no repeat was added."
        return nil
      end

      # Forward sign after measure s (left barline of measure s+1),
      # backward sign after measure e.
      [
        { measure: start, is_open: true, is_close: false, ending_number: 0, type: :repeat },
        { measure: end_measure - 1, is_open: false, is_close: true, ending_number: 0, type: :repeat }
      ]
    end

    # A same-start pair (s, L1), (s, L2) with L1 > L2: first/second ending
    # starting at measure s. Returns the three ending records, or nil when
    # the pair is not a volta.
    def self.decode_volta(start, entries, measure_count, warnings)
      lengths = entries.map { |entry| entry[:length] }
      first_ending = lengths.max
      second_ending = lengths.min

      if first_ending == second_ending
        warnings << "TEF2 repeat table has #{entries.size} entries with the same start (#{start}); no ending was decoded."
        return nil
      end
      unless start.positive? && second_ending.positive? && (first_ending + 1) <= measure_count
        warnings << "TEF2 repeat table entry (#{start}, #{first_ending}) is outside the score bounds; no ending was decoded."
        return nil
      end

      # Forward repeat at the section head.
      [
        { measure: start - 1, is_open: true, is_close: false, ending_number: 0, type: :ending },
        # First ending: one-measure span with the backward repeat sign.
        {
          measure: first_ending - 1, is_open: false, is_close: false,
          ending_number: 1, type: :ending, span: true, repeat: true
        },
        # Second ending: one-measure span, no repeat sign.
        {
          measure: first_ending, is_open: false, is_close: false,
          ending_number: 2, type: :ending, span: true, repeat: false
        }
      ]
    end
  end
end
