# frozen_string_literal: true

module Tef2
  # TablEdit 3 stores the playing order as a reading list: up to 96
  # measure ranges played one after another (for example 1-8, 1-7, 9-16:
  # play 1-8, go back and play 1-7, then jump to 9). TablEdit derives its
  # repeat signs, endings and D.C./D.S. markings from that list.
  #
  # This module turns a reading list into the per-measure repeat, ending and
  # jump marks that MusicXML (and alphaTab) play, works out the playing
  # order of those marks the way alphaTab does, and compresses a playing
  # order back into a reading list for export.
  module ReadingList
    MAX_SEQUENCES = 96

    # sequences: [[from, to], ...] with 1-based measure numbers.
    # Returns [bars, warnings]: one hash per measure (0-based), or nil when
    # the list is only the written order.
    def self.decode(sequences, measure_count)
      return [ nil, [] ] if sequences.empty?
      unless sequences.all? { |from, to| from.between?(1, to) && to <= measure_count }
        return [ nil, [ "The TablEdit reading list refers to measures outside the score; the score plays in written order." ] ]
      end

      bars = Array.new(measure_count) { blank_bar }
      warnings = []
      repeats = []
      explained = {}
      jumped = false
      seqs = sequences.map { |from, to| [ from - 1, to - 1 ] }
      i = 0
      while i < seqs.length - 1
        from1, to1 = seqs[i]
        from2, to2 = seqs[i + 1]
        if from2 == to1 + 1 || explained[[ to1, from2 ]]
          i += 1
        elsif from2 <= to1
          fits = !jumped && repeats.none? { |first, last| first <= to1 && last >= from2 }
          after = seqs[i + 2]
          if fits && to2 >= to1
            # A plain repeat, played once more for each identical pass.
            times = 2
            j = i + 1
            while seqs[j] == [ from2, to1 ] && seqs[j + 1] && seqs[j + 1][0] == from2
              times += 1
              j += 1
            end
            bars[from2][:forward] = true
            bars[to1][:backward] = times
            repeats << [ from2, to1 ]
            explained[[ to1, from2 ]] = true
            i = j
          elsif fits && after && after[0] == to1 + 1
            # First and second endings: the second pass stops before the
            # first ending and continues after it. As in TablEdit's printed
            # scores (checked against the private PDFs), the first ending
            # may be long (18 measures in one tune) and the second ending
            # is the one measure after it, left out when the next repeat
            # starts there.
            next_return = seqs[i + 3..].to_a.each_with_index.find { |(from, _), offset| from <= seqs[i + 2 + offset][1] && from > to1 }&.first&.first
            second_last = [ to1 + 1, (next_return || measure_count) - 1 ].min
            bars[from2][:forward] = true
            bars[to1][:backward] = 2
            (to2 + 1..to1).each { |index| bars[index][:endings] = [ 1 ] }
            (to1 + 1..second_last).each { |index| bars[index][:endings] = [ 2 ] }
            repeats << [ from2, [ second_last, to1 ].max ]
            explained[[ to1, from2 ]] = true
            explained[[ to2, to1 + 1 ]] = true
            i += 2
          elsif jumped
            warnings << "The TablEdit reading list returns more than once; only the first D.C./D.S. is played."
            break
          else
            # A return that cannot be a repeat: D.C. to the start, or D.S.
            # to a segno. Later ranges that retrace it are already covered.
            from2.zero? ? bars[to1][:dacapo] = true : (bars[to1][:dalsegno] = true; bars[from2][:segno] = true)
            explained[[ to1, from2 ]] = true
            jumped = true
            i += 1
          end
        elsif jumped && bars.none? { |bar| bar[:coda] }
          bars[to1][:to_coda] = true
          bars[from2][:coda] = true
          explained[[ to1, from2 ]] = true
          i += 1
        else
          warnings << "The TablEdit reading list skips from measure #{to1 + 1} to #{from2 + 1}; the score plays the skipped measures."
          i += 1
        end
      end

      last = seqs.last[1]
      if last < measure_count - 1
        if jumped && bars.none? { |bar| bar[:coda] }
          bars[last][:fine] = true
        else
          warnings << "The TablEdit reading list ends at measure #{last + 1}; the score plays the remaining measures."
        end
      end
      if bars.any? { |bar| bar[:dalsegno] || bar[:dacapo] } && repeats.any?
        expected = seqs.flat_map { |from, to| (from..to).to_a }
        if playback_order(bars) != expected
          warnings << "After a D.C. or D.S., repeats play once, so the playing order differs from TablEdit's reading list."
        end
      end
      [ bars, warnings ]
    end

    def self.blank_bar
      { forward: false, backward: 0, endings: [], segno: false, coda: false, to_coda: false, dacapo: false, dalsegno: false, fine: false }
    end

    # The measure order alphaTab plays: repeats and endings until a D.C. or
    # D.S. (al Coda when the score has a To Coda, al Fine when it has a
    # Fine), and every measure once after it.
    def self.playback_order(bars)
      order = []
      index = 0
      mode = :normal
      repeat = nil
      carried = []
      steps = 0
      while index < bars.length && (steps += 1) < 20_000
        bar = bars[index]
        play = true
        if mode == :normal
          endings = bar[:endings].empty? ? carried : bar[:endings]
          if bar[:forward] && repeat&.dig(:start) != index
            close = (index...bars.length).find { |candidate| bars[candidate][:backward].positive? }
            if close && (index + 1...close).none? { |candidate| bars[candidate][:forward] }
              repeat = { start: index, close: close, pass: 0 }
              carried = []
              endings = bar[:endings]
            end
          end
          if repeat && endings.any?
            carried = endings
            play = endings.include?(repeat[:pass] + 1)
          end
        end
        order << index if play

        case mode
        when :normal
          if bar[:dacapo] || (bar[:dalsegno] && (target = find(bars, index, :segno, backwards_first: true)))
            index = bar[:dacapo] ? 0 : target
            mode = bars.any? { |item| item[:to_coda] } ? :al_coda : bars.any? { |item| item[:fine] } ? :al_fine : :plain
            repeat = nil
            carried = []
            next
          end
        when :al_coda
          if bar[:to_coda]
            coda = find(bars, index, :coda, backwards_first: false)
            index = coda || index + 1
            mode = :normal if coda
            next
          end
          index += 1
          next
        when :al_fine
          break if bar[:fine]

          index += 1
          next
        else
          index += 1
          next
        end

        if repeat && index == repeat[:close] && repeat[:pass] < bar[:backward] - 1
          repeat[:pass] += 1
          carried = []
          index = repeat[:start]
        else
          repeat = nil if repeat && index == repeat[:close]
          index += 1
        end
      end
      order
    end

    def self.find(bars, index, mark, backwards_first:)
      backwards = index.downto(0).find { |candidate| bars[candidate][mark] }
      forwards = (index...bars.length).find { |candidate| bars[candidate][mark] }
      backwards_first ? backwards || forwards : forwards || backwards
    end

    # Splits a playing order (0-based measures) into 1-based reading-list
    # ranges. The written order alone needs no list.
    def self.sequences(order)
      return [] if order.empty? || order == (0...order.length).to_a

      order.slice_when { |previous, current| current != previous + 1 }.map { |run| [ run.first + 1, run.last + 1 ] }
    end
  end
end
