# frozen_string_literal: true

module Tef2
  # Decodes the verified subset of the TEF2 repeat table into MusicXML
  # ending records consumed by FullMusicxmlBuilder.
  #
  # Verified against TefView and the printed PDFs in the private Brainjo
  # corpus (2026-09-16): entries sharing a start describe a first/second
  # ending. For a start s and lengths L1 > L2:
  #   * first pass plays measures s..L1 (the first ending covers measure L1)
  #   * second pass plays s..L2, then measure L1+1 (the second ending)
  #
  # The section start is 1-based: the printed forward repeat sign sits at
  # measure s (corpus-verified for s = 1, 9, and 10). All other repeat
  # entries (single pairs and chains whose semantics are not yet verified)
  # are not decoded; they remain raw repeat-map metadata with a visible
  # import warning.
  module RepeatMap
    # Returns [endings, warnings]. Ending records use the same shape as
    # TableditV3Parser ending records (0-based measure indexes) plus the
    # :span and :repeat fields understood by FullMusicxmlBuilder.
    def self.volta_endings(repeats, measure_count)
      endings = []
      warnings = []

      repeats.group_by { |entry| entry[:start] }.each do |start, entries|
        next if entries.size < 2
        if entries.size > 2
          warnings << "TEF2 repeat table has #{entries.size} entries with the same start (#{start}); no ending was decoded."
          next
        end

        lengths = entries.map { |entry| entry[:length] }
        first_ending = lengths.max
        second_ending = lengths.min

        if first_ending == second_ending
          warnings << "TEF2 repeat table has #{entries.size} entries with the same start (#{start}); no ending was decoded."
          next
        end
        unless start.positive? && second_ending.positive? && (first_ending + 1) <= measure_count
          warnings << "TEF2 repeat table entry (#{start}, #{first_ending}) is outside the score bounds; no ending was decoded."
          next
        end

        # Forward repeat at the section head.
        endings << { measure: start - 1, is_open: true, is_close: false, ending_number: 0, type: :ending }
        # First ending: one-measure span with the backward repeat sign.
        endings << {
          measure: first_ending - 1, is_open: false, is_close: false,
          ending_number: 1, type: :ending, span: true, repeat: true
        }
        # Second ending: one-measure span, no repeat sign.
        endings << {
          measure: first_ending, is_open: false, is_close: false,
          ending_number: 2, type: :ending, span: true, repeat: false
        }
      end

      endings.sort_by! { |record| record[:measure] }
      [ endings, warnings ]
    end
  end
end
