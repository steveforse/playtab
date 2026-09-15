# frozen_string_literal: true

require "pdf/reader"
require "set"
require "stringio"
require "ttfunk"
require "zlib"

module Tef2
  # Recognizes the positioned text and tablature geometry in vector PDFs.
  #
  # A rendered PDF cannot retain every source-score detail, so this recognizer
  # deliberately returns a bounded score model and explicit warnings for the
  # information that must be inferred.
  class PdfRecognizer
    class Error < StandardError; end

    MAX_PDF_SIZE = 10_000_000
    MAX_PAGES = 64
    MEASURE_TICKS = 1024
    POSITION_STEP = 128
    POSITION_LEFT_MARGIN_RATIO = 0.08
    POSITION_RIGHT_MARGIN_RATIO = 0.02

    SECTION_LABELS = %w[
      intro verse verses chorus bridge high\ solo low\ solo solo outro tag break ending
    ].to_set.freeze

    TECHNIQUE_LABELS = {
      "h" => "hammer-on",
      "ho" => "hammer-on",
      "hammeron" => "hammer-on",
      "po" => "pull-off",
      "pulloff" => "pull-off",
      "p/o" => "pull-off",
      "slide" => "slide",
      "sl" => "slide",
      "s" => "slide",
      "bend" => "bend",
      "b" => "bend",
      "t" => "thumb",
      "thumb" => "thumb"
    }.freeze

    class PageReceiver < PDF::Reader::PageTextReceiver
      attr_reader :segments, :time_signature_symbols, :curve_boxes

      def initialize
        super
        @segments = []
        @flat_symbols = []
        @time_signature_symbols = []
        @curve_boxes = []
        @pending = nil
      end

      attr_reader :flat_symbols

      def show_text(string)
        origin = state.trm_transform_point(0, 0)
        if string == "!"
          @flat_symbols << { x: origin.x, y: origin.y, text: string }
        end
        if [ "!", '"' ].include?(string) && state.respond_to?(:current_font)
          @time_signature_symbols << {
            x: origin.x,
            y: origin.y,
            code: string.ord,
            font: state.current_font
          }
        end
        super
      end

      def time_signature
        numerator = time_signature_symbols.find do |symbol|
          symbol[:code] == 33 && time_signature_symbols.any? do |other|
            other[:code] == 34 && (other[:x] - symbol[:x]).abs <= 2 && (other[:y] - symbol[:y]).abs.between?(8, 16)
          end
        end
        return unless numerator

        value = numerator_value(numerator)
        value && { numerator: value, denominator: 4 }
      rescue StandardError
        nil
      end

      private def numerator_value(symbol)
        font = symbol[:font]
        descriptor = font.font_descriptor
        stream = descriptor.instance_variable_get(:@font_program_stream)
        raw = stream&.instance_variable_get(:@data)
        return unless raw

        ttf = TTFunk::File.open(StringIO.new(Zlib::Inflate.inflate(raw)))
        cmap = ttf.cmap.tables.find { |table| table[symbol[:code]] }
        return unless cmap

        glyph = ttf.find_glyph(cmap[symbol[:code]])
        width = glyph.x_max - glyph.x_min
        return 4 if width < 280
        return 3 if width < 370

        2
      end

      def begin_new_subpath(x, y)
        point = state.ctm_transform_point(x, y)
        @pending = [ point.x, point.y ]
      end

      def append_line(x, y)
        point = state.ctm_transform_point(x, y)
        if @pending
          x1, y1 = @pending
          @segments << [ x1, y1, point.x, point.y ]
        end
        @pending = nil
      end

      def close_subpath(*); @pending = nil; end
      def close_and_stroke_path(*); @pending = nil; end
      def stroke_path(*); @pending = nil; end
      def fill_path_with_nonzero(*); @pending = nil; end
      def fill_path_with_even_odd(*); @pending = nil; end
      def close_fill_stroke(*); @pending = nil; end
      def close_fill_stroke_with_even_odd(*); @pending = nil; end
      def fill_stroke(*); @pending = nil; end
      def fill_stroke_with_even_odd(*); @pending = nil; end
      def end_path(*); @pending = nil; end

      def append_curved_segment(*args); record_curve_box(args); end
      def append_curved_segment_initial_point_replicated(*args); record_curve_box(args); end
      def append_curved_segment_final_point_replicated(*args); record_curve_box(args); end

      private

      def record_curve_box(args)
        points = args.each_slice(2).filter_map do |x, y|
          next unless x.is_a?(Numeric) && y.is_a?(Numeric)

          state.ctm_transform_point(x, y)
        end
        return if points.empty?

        xs = points.map(&:x)
        ys = points.map(&:y)
        @curve_boxes << {
          x: (xs.min + xs.max) / 2.0,
          y: (ys.min + ys.max) / 2.0,
          width: xs.max - xs.min,
          height: ys.max - ys.min
        }
      end

      public

      def method_missing(name, *args)
        state.public_send(name, *args) if state&.respond_to?(name)
      end

      def respond_to_missing?(_name, _include_private = false)
        true
      end
    end

    def self.recognize(data, filename: "")
      new.recognize(data, filename: filename)
    end

    def recognize(data, filename: "")
      validate_upload!(data)
      reader = read_pdf(data)
      raise Error, "PDF page count is outside the supported range." unless reader.page_count.between?(1, MAX_PAGES)

      pages = reader.pages.each_with_index.map do |page, page_index|
        page_data = read_page(page)
        page_data[:systems].each { |system| system[:page] = page_index }
        page_data
      end
      time_signature = pages.filter_map { |page| page[:time_signature] }.first || { numerator: 4, denominator: 4 }
      measure_ticks = pdf_measure_ticks(time_signature)
      systems = pages.flat_map { |page| page[:systems] }
      # The page receiver normalizes the PDF coordinates to screen order:
      # larger y values are visually higher on the page. Musical order is
      # therefore top-to-bottom within each page.
      systems.sort_by! { |system| [ system[:page], -system[:top] ] }
      if systems.empty?
        raise Error, "No five-line tablature systems were found. This PDF may be a scan or an unsupported layout."
      end

      notes = []
      measure_index = 0
      timing_steps = Set.new
      systems.each do |system|
        system[:measure_start] = measure_index
        system[:measure_ticks] = measure_ticks
        system[:measure_layouts] = []
        system[:bars].each_cons(2).with_index do |(left, right), measure_offset|
          events = system[:events].select { |event| left + 5 <= event[:x] && event[:x] < right - 2 }
          event_xs = events.map { |event| event[:x] }
          step = position_step(left, right, event_xs, measure_ticks: measure_ticks)
          layout = position_layout(left, right, event_xs, measure_ticks, step)
          system[:measure_layouts] << { step: step, layout: layout }
          timing_steps << step
          events.each do |event|
            position = position(event[:x], left, right, step: step, measure_ticks: measure_ticks, layout: layout)
            event[:notes].each do |note|
              notes << {
                measure: measure_index + measure_offset,
                position: position,
                string: note[:string],
                fret: note[:fret],
                dead: note[:dead]
              }
            end
          end
        end
        measure_index += [ system[:bars].length - 1, 0 ].max
      end

      raise Error, "No tablature notes were recognized." if notes.empty?

      title, tuning = header(pages.first[:texts])
      metadata = metadata(pages, systems)
      timing_name = timing_steps.any? { |step| step <= 64 } ? "sixteenth-note" : "eighth-note"
      warnings = [
        "PDF note timing is inferred from horizontal layout and rounded to the nearest #{timing_name} position.",
        "PDF recognition cannot guarantee hidden TEF duration, voice, repeat, or source metadata fidelity."
      ]
      warnings << "The PDF tuning label was not recognized; review the imported tuning." if tuning.empty?
      warnings << "No section labels were confidently associated with tablature measures." if metadata[:sections].empty?
      warnings << "No chord names were confidently associated with tablature measures." if metadata[:chords].empty?
      warnings << "No standalone lyric page was recognized." unless metadata[:lyrics]
      warnings << "No printed technique labels were confidently associated with notes." if metadata[:techniques].empty?
      warnings << "No printed fingering annotations were confidently associated with notes." if metadata[:fingerings].empty?
      warnings << "No printed tempo was found as selectable PDF text; review the imported tempo." unless metadata[:tempo]
      warnings << "PDF chord names are preserved without chord voicings or diagrams." unless metadata[:chords].empty?

      skipped_techniques = metadata[:techniques].count do |technique|
        %w[hammer-on pull-off].include?(technique[:type]) && !technique_pair_valid?(technique, notes)
      end
      if skipped_techniques.positive?
        warnings << "#{skipped_techniques} PDF legato mark(s) were not attached because the nearby frets did not confirm its direction."
      end

      {
        title: title.empty? ? filename_without_extension(filename) : title,
        tuning_label: tuning,
        measures: measure_index,
        time_signature: time_signature,
        notes: notes,
        tempo: metadata[:tempo],
        sections: metadata[:sections],
        chords: metadata[:chords],
        repeats: metadata[:repeats],
        lyrics: metadata[:lyrics],
        techniques: metadata[:techniques],
        fingerings: metadata[:fingerings],
        warnings: warnings
      }
    end

    private

    def validate_upload!(data)
      raise Error, "PDF upload is not binary data." unless data.is_a?(String)
      raise Error, "PDF upload is empty or too large." unless data.bytesize.between?(1, MAX_PDF_SIZE)
      raise Error, "This file is not a PDF." unless data.start_with?("%PDF-")
    end

    def read_pdf(data)
      PDF::Reader.new(StringIO.new(data))
    rescue StandardError => e
      raise Error, "This PDF could not be read safely.", cause: e
    end

    def read_page(page)
      receiver = PageReceiver.new
      page.walk(receiver)
      texts = receiver.runs(merge: true).filter_map do |run|
        value = run.text.to_s.gsub("\n", "").strip
        next if value.empty?

        x = run.x.to_f
        y = run.y.to_f
        next unless x.between?(5, page.width - 5) && y.between?(10, page.height - 10)

        { x: x, y: y, text: value }
      end
      receiver.flat_symbols.each do |symbol|
        texts.each do |item|
          next unless (item[:y] - symbol[:y]).abs <= 4
          next unless item[:x] <= symbol[:x] && symbol[:x] - item[:x] <= 32
          next unless item[:text].match?(/\A[A-Ga-g]\s+(?:Maj|Min|maj|min|m|M|dim|aug|sus\d*)\z/)

          match = item[:text].match(/\A([A-Ga-g])\s+(.*)\z/)
          item[:text] = "#{match[1]}! #{match[2]}"
          break
        end
      end
      note_texts = receiver.runs(merge: false).filter_map do |run|
        value = run.text.to_s.gsub("\n", "").strip
        next if value.empty?

        x = run.x.to_f
        y = run.y.to_f
        next unless x.between?(5, page.width - 5) && y.between?(10, page.height - 10)

        { x: x, y: y, text: value }
      end
      segments = receiver.segments.select do |x1, y1, x2, y2|
        [ x1, x2 ].min >= 5 && [ x1, x2 ].max <= 607 && [ y1, y2 ].min >= 10 && [ y1, y2 ].max <= 782
      end
      curve_boxes = receiver.respond_to?(:curve_boxes) ? receiver.curve_boxes : []
      page_systems = systems(note_texts, segments, curve_boxes)
      detected_time_signature = receiver.respond_to?(:time_signature) ? receiver.time_signature : nil
      symbols = receiver.respond_to?(:time_signature_symbols) ? receiver.time_signature_symbols : []
      detected_time_signature = infer_time_signature_from_spacing(detected_time_signature, symbols, page_systems)
      { texts: texts, systems: page_systems, time_signature: detected_time_signature }
    rescue Error
      raise
    rescue StandardError => e
      raise Error, "A PDF page could not be read safely.", cause: e
    end

    def systems(texts, segments, curve_boxes = [])
      horizontal = segments.filter_map do |x1, y1, x2, y2|
        next unless (y1 - y2).abs < 0.8 && (x2 - x1).abs >= 100

        [ (y1 + y2) / 2.0, [ x1, x2 ].min, [ x1, x2 ].max ]
      end

      lines = []
      horizontal.sort_by(&:first).each do |y, start, finish|
        if lines.empty? || (y - lines.last[0]).abs > 0.8
          lines << [ y, start, finish ]
        else
          lines.last[1] = [ lines.last[1], start ].min
          lines.last[2] = [ lines.last[2], finish ].max
        end
      end

      result = []
      cursor = 0
      while cursor + 4 < lines.length
        candidate = lines[cursor, 5]
        spacing = candidate.each_cons(2).map { |first, second| second[0] - first[0] }
        if spacing.max - spacing.min > 1.5
          cursor += 1
          next
        end

        start = candidate.map { |line| line[1] }.max
        finish = candidate.map { |line| line[2] }.min
        if finish - start < 100
          cursor += 1
          next
        end

        top = candidate.first[0]
        bottom = candidate.last[0]
        raw_bars = segments.filter_map do |x1, y1, x2, y2|
          next unless (x1 - x2).abs < 0.8 && [ y1, y2 ].min <= top + 1 && [ y1, y2 ].max >= bottom - 1

          x = (x1 + x2) / 2.0
          x if x.between?(start - 2, finish + 2)
        end
        repeat_barlines = repeat_barlines(raw_bars, curve_boxes, top, bottom, start, finish)
        # TablEdit commonly draws a barline as two very close vertical
        # strokes. Treat that pair as one boundary or it becomes a phantom
        # measure and shifts every following note.
        bars = unique_sorted(raw_bars, 4.0)
        if bars.length < 2
          cursor += 5
          next
        end

        row_positions = 5.times.map { |index| bottom - index * (bottom - top) / 4.0 }
        note_text = texts.filter_map do |item|
          next unless item[:x].between?(start + 10, finish - 2) && item[:y].between?(top - 5, bottom + 5)

          nearest = (0...5).min_by { |index| (item[:y] - row_positions[index]).abs }
          next unless (item[:y] - row_positions[nearest] + 3.6).abs <= 5

          if item[:text].match?(/\A\d{1,2}\z/)
            { x: item[:x], y: item[:y], string: nearest, fret: item[:text].to_i, dead: false }
          elsif item[:text].upcase == "X"
            { x: item[:x], y: item[:y], string: nearest, fret: 0, dead: true }
          end
        end

        events = []
        note_text.sort_by { |item| item[:x] }.each do |note|
          event = events.find { |candidate_event| (candidate_event[:x] - note[:x]).abs < 3 }
          if event
            event[:notes] << note
          else
            events << { x: note[:x], notes: [ note ] }
          end
        end

        result << { page: 0, top: top, bottom: bottom, bars: bars, repeat_barlines: repeat_barlines, events: events, texts: texts }
        cursor += 5
      end
      result
    end

    def repeat_barlines(raw_bars, curve_boxes, top, bottom, start, finish)
      bars = raw_bars.sort.uniq
      circles = circle_centers(curve_boxes).select do |x, y|
        x.between?(start - 20, finish + 20) && y.between?(top - 2, bottom + 2)
      end
      bars.each_cons(2).filter_map do |left, right|
        next unless (right - left).between?(1.0, 4.5)

        pair = [ left, right ]
        direction = if repeat_dots?(circles, pair, side: :right)
          "forward"
        elsif repeat_dots?(circles, pair, side: :left)
          "backward"
        end
        next unless direction

        { boundary: pair.sum / 2.0, direction: direction }
      end.uniq
    end

    def circle_centers(curve_boxes)
      points = curve_boxes.filter_map do |box|
        next unless box[:width] <= 4 && box[:height] <= 4

        [ box[:x], box[:y] ]
      end
      groups = []
      points.sort_by { |x, y| [ y, x ] }.each do |point|
        group = groups.find { |candidate| candidate.any? { |x, y| (x - point[0]).abs <= 4 && (y - point[1]).abs <= 4 } }
        group ? group << point : groups << [ point ]
      end
      groups.filter_map do |group|
        next if group.length < 3

        [ group.sum { |x, _y| x } / group.length, group.sum { |_x, y| y } / group.length ]
      end
    end

    def repeat_dots?(circles, pair, side:)
      left, right = pair
      candidates = circles.select do |x, _y|
        distance = side == :right ? x - right : left - x
        distance.between?(0.5, 18)
      end
      candidates.combination(2).any? do |first, second|
        (first[0] - second[0]).abs <= 3 && (first[1] - second[1]).abs.between?(6, 14)
      end
    end

    def metadata(pages, systems)
      sections = []
      chords = []
      techniques = []
      fingerings = []
      systems.each do |system|
        page_texts = pages[system[:page]][:texts]
        sections.concat(sections_for_system(system, page_texts))
        chords.concat(chords_for_system(system, page_texts))
        techniques.concat(techniques_for_system(system, page_texts))
        fingerings.concat(fingerings_for_system(system, page_texts))
      end
      {
        sections: deduplicate_metadata(sections),
        chords: deduplicate_metadata(chords),
        repeats: repeat_metadata(systems),
        lyrics: lyrics(pages),
        techniques: deduplicate_metadata(techniques),
        fingerings: deduplicate_metadata(fingerings),
        tempo: tempo(pages)
      }
    end

    def repeat_metadata(systems)
      systems.flat_map do |system|
        system.fetch(:repeat_barlines, []).filter_map do |repeat|
          boundary = system[:bars].index { |bar| (bar - repeat[:boundary]).abs <= 4.5 }
          next unless boundary

          if repeat[:direction] == "forward"
            { measure: system.fetch(:measure_start, 0) + boundary, location: "left", direction: "forward", confidence: "high" }
          elsif boundary.positive? || system.fetch(:measure_start, 0).positive?
            { measure: system.fetch(:measure_start, 0) + boundary - 1, location: "right", direction: "backward", confidence: "high" }
          end
        end
      end
    end

    def infer_time_signature_from_spacing(time_signature, symbols, page_systems)
      return time_signature unless time_signature&.fetch(:numerator, nil) == 2

      symbol = symbols.find { |item| item[:code] == 33 }
      system = page_systems.find do |candidate|
        symbol && symbol[:y].between?(candidate[:top] - 5, candidate[:bottom] + 5)
      end
      return time_signature unless system

      gaps = system[:bars].each_cons(2).flat_map do |left, right|
        system[:events].select { |event| left + 5 <= event[:x] && event[:x] < right - 2 }.map { |event| event[:x] }
          .sort.each_cons(2).map { |first, second| second - first }
      end.select { |gap| gap > 1.5 }.sort
      return time_signature if gaps.empty?

      { numerator: gaps[gaps.length / 2] >= 15 ? 3 : 2, denominator: 4 }
    end

    def deduplicate_metadata(items)
      result = []
      seen = Set.new
      items.sort_by { |item| [ item.fetch(:measure, 0), item.fetch(:position, 0), item.fetch(:text, item.fetch(:type, "")) ] }.each do |item|
        key = item.sort_by { |name, _| name.to_s }.to_h.to_a
        next if seen.include?(key)

        seen << key
        result << item
      end
      result
    end

    def sections_for_system(system, texts)
      texts.filter_map do |item|
        label = item[:text].gsub(/\s+/, " ").strip
        next unless section_label?(system, item, label)
        next unless near_system?(system, item[:x], item[:y], 42)

        target = metadata_system_for_overflow(system, item[:x])
        measure, position = measure_position(target, item[:x])
        { measure: measure, position: position, text: label, confidence: "high" }
      end
    end

    def chords_for_system(system, texts)
      candidates = texts.select do |item|
        item[:x].between?(system[:bars].first - 18, system[:bars].last + 18) &&
          item[:y].between?(system[:bottom] + 8, system[:bottom] + 35)
      end
      groups = []
      candidates.sort_by { |item| [ item[:y], item[:x] ] }.each do |item|
        group = groups.find do |candidate_group|
          (candidate_group.first[:y] - item[:y]).abs <= 4.0 && item[:x] - candidate_group.last[:x] <= 20
        end
        if group
          group << item
        else
          groups << [ item ]
        end
      end

      groups.filter_map do |group|
        label = normalize_chord(group.sort_by { |item| item[:x] }.map { |item| item[:text] }.join(" "))
        next if label.empty?

        item = group.first
        measure, position = measure_position(system, item[:x])
        { measure: measure, position: position, name: label, confidence: "high" }
      end
    end

    def normalize_chord(value)
      value = value.tr("!♭♯", "b♭#")
      value = value.gsub(/\s+/, " ").strip
      value = value.gsub(/\A([A-Ga-g])\s+([#b])/, '\1\2')
      suffix_pattern = "(?:Maj|Min|maj|min|major|minor|m|M|dim|aug|sus\d*|7|maj7|min7|m7|dim7|aug7)"
      match = value.match(/\A([A-Ga-g](?:[#b])?)\s*(#{suffix_pattern})?\z/)
      return "" unless match

      root = match[1][0].upcase + match[1][1..]
      suffix = match[2]
      suffix = "min" if suffix == "m"
      return root unless suffix

      suffix.match?(/\A(?:\d|maj\d|min\d|m\d|dim\d|aug\d)/i) ? "#{root}#{suffix}" : "#{root} #{suffix}"
    end

    def techniques_for_system(system, texts)
      texts.filter_map do |item|
        label = item[:text].strip
        technique = technique_type(label)
        next unless technique && near_system?(system, item[:x], item[:y], 42)

        note = nearest_note(system, item[:x])
        target = metadata_system_for_overflow(system, item[:x])
        note ||= nearest_note(target, item[:x])
        next unless note

        measure, position = measure_position(target, note[:x])
        {
          measure: measure,
          position: position,
          string: note[:string],
          type: technique,
          label: item[:text].strip,
          confidence: %w[slide bend].include?(technique) ? "medium" : "high"
        }
      end
    end

    def fingerings_for_system(system, texts)
      texts.filter_map do |item|
        next unless item[:text].match?(/\A[1-4]\z/)
        next if item[:y].between?(system[:top] - 8, system[:bottom] + 8)
        next unless item[:y].between?(system[:top] - 34, system[:bottom] + 34)
        next unless item[:x].between?(system[:bars].first - 18, system[:bars].last + 18)

        note = nearest_note(system, item[:x], 16)
        next unless note

        measure, position = measure_position(system, note[:x])
        { measure: measure, position: position, string: note[:string], value: item[:text].strip, confidence: "medium" }
      end
    end

    def technique_pair_valid?(technique, notes)
      current = notes.find do |note|
        note[:measure] == technique[:measure] && note[:position] == technique[:position] && note[:string] == technique[:string]
      end
      return false unless current

      following = notes.find do |note|
        note[:string] == current[:string] && ([ note[:measure], note[:position] ] <=> [ current[:measure], current[:position] ]) == 1
      end
      return false unless following

      technique[:type] == "hammer-on" ? current[:fret] < following[:fret] : current[:fret] > following[:fret]
    end

    def technique_type(value)
      label = value.downcase.strip
      TECHNIQUE_LABELS[label] || TECHNIQUE_LABELS[label.gsub(/[\s._-]+/, "")]
    end

    def section_label?(system, item, label)
      return true if SECTION_LABELS.include?(label.downcase)
      return false if item[:y] >= system[:top] - 8
      return false unless label.length.between?(2, 32) && label.match?(/[a-zA-Z]/)
      return false if technique_type(label) || !normalize_chord(label).empty?
      return false if label.match?(/(?:page\s+\d|tuning|arranged|clawhammerbanjo|\.net)/i)

      true
    end

    def near_system?(system, x, y, vertical)
      x.between?(system[:bars].first - 18, system[:bars].last + 18) && y.between?(system[:top] - vertical, system[:bottom] + vertical)
    end

    def nearest_note(system, x, limit = 24)
      notes = system[:events].flat_map { |event| event[:notes] }
      return unless notes.any?

      note = notes.min_by { |candidate| (candidate[:x] - x).abs }
      note if (note[:x] - x).abs <= limit
    end

    def metadata_system_for_overflow(system, _x)
      system
    end

    def measure_position(system, x)
      bars = system[:bars]
      measure_offset = [ bars.length - 2, 0 ].max
      bars[1..].each_with_index do |right, index|
        if x < right
          measure_offset = index
          break
        end
      end
      left = bars[measure_offset]
      right = bars[measure_offset + 1]
      measure_ticks = system.fetch(:measure_ticks, MEASURE_TICKS)
      geometry = system[:measure_layouts]&.[](measure_offset)
      if geometry
        step = geometry[:step]
        layout = geometry[:layout]
      else
        event_xs = system[:events].select { |event| left + 5 <= event[:x] && event[:x] < right - 2 }.map { |event| event[:x] }
        step = position_step(left, right, event_xs, measure_ticks: measure_ticks)
        layout = position_layout(left, right, event_xs, measure_ticks, step)
      end
      [ system[:measure_start] + measure_offset, position(x, left, right, step: step, measure_ticks: measure_ticks, layout: layout) ]
    end

    def lyrics(pages)
      collected = []
      lyrics_started = false
      pages.each do |page|
        heading = page[:texts].find { |item| item[:text].match?(/\ALYRICS(?:\s*&\s*CHORDS)?\z/i) }
        if heading
          lyrics_started = true
          collected.concat(lyrics_items(page, maximum_y: heading[:y]).sort_by { |item| [ -item[:y], item[:x] ] })
        elsif lyrics_started && page[:systems].empty?
          collected.concat(lyrics_items(page).sort_by { |item| [ -item[:y], item[:x] ] })
        end
      end
      return collected.map { |item| item[:text].strip }.join("\n") if collected.any?

      candidates = pages.filter_map do |page|
        next if page[:systems].any?

        body = page[:texts].select { |item| item[:y] < 735 && item[:y] > 55 && item[:x] < 120 }
        body if body.length >= 4
      end
      return unless candidates.any?

      value = candidates.first.sort_by { |item| [ -item[:y], item[:x] ] }.map { |item| item[:text].strip }.reject(&:empty?).join("\n")
      value unless value.empty?
    end

    def lyrics_items(page, maximum_y: 735)
      page[:texts].select do |item|
        item[:y] < maximum_y && item[:y] > 55 && item[:x] < 120 &&
          !item[:text].match?(/\A(?:lyrics(?:\s*&\s*chords)?|verse|chorus)\z/i) &&
          normalize_chord(item[:text]).empty? && !item[:text].match?(/\A\d{1,2}\z/)
      end
    end

    def tempo(pages)
      pages.each do |page|
        texts = page[:texts]
        texts.each do |item|
          value = item[:text]
          [
            /(?:tempo|bpm)\s*[:=]?\s*(\d{2,3})/i,
            /(?:m\.?\s*m\.?|mm)\s*[:=]?\s*(\d{2,3})/i,
            /(?:quarter(?:\s+note)?|q|[♩♪♫])\s*(?:=|at)\s*(\d{2,3})/i
          ].each do |pattern|
            match = value.match(pattern)
            return match[1].to_i if match
          end
        end

        texts.each do |symbol|
          next unless symbol[:text].match?(/(?:quarter|metronome|[♩♪♫])/i)

          texts.each do |number|
            next unless number[:text].match?(/\A\d{2,3}\z/)
            return number[:text].to_i if (symbol[:y] - number[:y]).abs <= 6 && number[:x] > symbol[:x] && number[:x] - symbol[:x] <= 96
          end
        end
      end
      nil
    end

    def position_step(left, right, event_xs, measure_ticks: MEASURE_TICKS)
      unique_xs = event_xs.compact.uniq.sort
      return POSITION_STEP if unique_xs.length < 2

      gaps = unique_xs.each_cons(2).map { |first, second| second - first }.select { |gap| gap > 1.5 }
      return POSITION_STEP if gaps.empty?

      subdivisions = (right - left) / gaps.min
      return 32 if subdivisions >= 24
      return 64 if subdivisions >= 8 || (measure_ticks <= 512 && subdivisions >= 6)

      POSITION_STEP
    end

    def position(x, left, right, step: nil, event_xs: [], measure_ticks: MEASURE_TICKS, layout: nil)
      step ||= position_step(left, right, event_xs, measure_ticks: measure_ticks)
      layout ||= position_layout(left, right, event_xs, measure_ticks, step)
      raw = ((x - left - layout[:left_margin]).to_f / layout[:usable].to_f) * measure_ticks
      [ 0, [ measure_ticks - step, (raw / step).round * step ].min ].max
    end

    def position_layout(left, right, event_xs, measure_ticks, step)
      width = right - left
      default_left = [ 12.0, [ 6.0, width * POSITION_LEFT_MARGIN_RATIO ].max ].min
      default_right = [ 4.0, [ 2.0, width * POSITION_RIGHT_MARGIN_RATIO ].max ].min
      default = { left_margin: default_left, right_margin: default_right, usable: [ 1.0, width - default_left - default_right ].max }
      if measure_ticks == 768 && event_xs.length == 1 && event_xs.first - left <= width * 0.2
        return { left_margin: event_xs.first - left, right_margin: 0, usable: width }
      end
      return default if event_xs.length < 2

      best = nil
      max_left = (width * 0.8 * 2).round
      gaps = event_xs.sort.each_cons(2).map { |first, second| second - first }.select { |gap| gap > 1.5 }
      spacing = gaps.min
      if measure_ticks == 768 && spacing && event_xs.first - left <= spacing * 1.5
        usable = spacing * measure_ticks / step
        return { left_margin: event_xs.first - left, right_margin: width - (event_xs.first - left) - usable, usable: usable }
      end
      (0..max_left).each do |left_units|
        left_margin = left_units / 2.0
        max_right = (width * 0.2 * 2).round
        (0..max_right).each do |right_units|
          right_margin = right_units / 2.0
          usable = [ 1.0, width - left_margin - right_margin ].max
          error = event_xs.sum do |x|
            raw = ((x - left - left_margin) / usable) * measure_ticks
            quantized = (raw / step).round * step
            quantized = [ 0, [ measure_ticks - step, quantized ].min ].max
            (raw - quantized)**2
          end
          candidate = [ error, left_margin + right_margin, left_margin, right_margin, usable ]
          best = candidate if best.nil? || (candidate[0, 2] <=> best[0, 2]) == -1
        end
      end

      if spacing && measure_ticks == 768
        inferred_usable_values = [
          spacing * measure_ticks / step,
          spacing * measure_ticks / step / 2.0,
          spacing * measure_ticks / step * 2.0
        ]
        min_left = (-width * 0.5 * 2).floor
        inferred_usable_values.each do |usable|
          (min_left..max_left).each do |left_units|
          left_margin = left_units / 2.0
          error = event_xs.sum do |x|
            raw = ((x - left - left_margin) / usable) * measure_ticks
            quantized = (raw / step).round * step
            quantized = [ 0, [ measure_ticks - step, quantized ].min ].max
            (raw - quantized)**2
          end
          candidate = [ error, 0, left_margin, width - left_margin - usable, usable ]
          best = candidate if (candidate[0, 2] <=> best[0, 2]) == -1
          end
        end
      end

      regular_spacing = measure_ticks <= 512 && gaps.length >= 2 && (gaps.max - gaps.min).abs <= 1.0 && event_xs.min - left <= spacing * 1.5
      if regular_spacing
        usable = spacing * measure_ticks / step
        (0..max_left).each do |left_units|
          left_margin = left_units / 2.0
          error = event_xs.sum do |x|
            raw = ((x - left - left_margin) / usable) * measure_ticks
            quantized = (raw / step).round * step
            quantized = [ 0, [ measure_ticks - step, quantized ].min ].max
            (raw - quantized)**2
          end
          candidate = [ error, 0, left_margin, width - left_margin - usable, usable ]
          best = candidate if (candidate[0, 2] <=> best[0, 2]) == -1
        end
      end

      { left_margin: best[2], right_margin: best[3], usable: best[4] }
    end

    def pdf_measure_ticks(time_signature)
      (MEASURE_TICKS * time_signature.fetch(:numerator, 4).to_f / time_signature.fetch(:denominator, 4)).round
    end

    def header(texts)
      top = texts.select { |item| item[:y] > 735 }
      title = top.sort_by { |item| -item[:y] }.find do |item|
        value = item[:text].downcase
        !value.include?("tuning") && !value.include?("arranged") && !value.include?("clawhammerbanjo")
      end
      header = top.sort_by { |item| item[:x] }.map { |item| item[:text] }.join(" ")
      match = header.match(/([a-gA-G][a-gA-G#b♭]{4,})\s+tuning/i)
      [ title ? title[:text] : "", match ? match[1] : "" ]
    end

    def filename_without_extension(filename)
      base = filename.to_s.split(/[\\\/]/).last.to_s
      base.sub(/\.[^.]*\z/, "")
    end

    def unique_sorted(values, tolerance = 2.0)
      values.sort.each_with_object([]) do |value, result|
        result << value if result.empty? || (value - result.last).abs > tolerance
      end
    end
  end
end
