# frozen_string_literal: true

require "open3"
require "timeout"
require "tmpdir"
require "vips"

module Tef2
  # Recognizes scanned tablature PDFs by rendering each page and recovering the
  # staff geometry and fret digits from the raster image. The score assembly,
  # rhythm inference, and MusicXML mapping live in PdfRecognizer so raster and
  # selectable-text imports produce the same score shape.
  class PdfRasterRecognizer < PdfRecognizer
    Error = PdfRecognizer::Error

    DPI = 300
    RASTER_TIMEOUT = 90
    DARK_PIXEL = 180
    STAFF_PIXEL = 220
    OCR_PIXEL = 150
    GRAY_OCR_PIXEL = 130
    MIN_STAFF_COVERAGE = 0.45
    MIN_LINE_RUN_RATIO = 0.30
    MAX_COMPONENT_WIDTH = 35
    MIN_COMPONENT_HEIGHT = 7
    MAX_COMPONENT_HEIGHT = 42
    MIN_COMPONENT_AREA = 8
    MIN_OCR_CONFIDENCE = 45
    MAX_FRET = 24

    def self.recognize(data, filename: "")
      new.recognize(data, filename: filename)
    end

    def recognize(data, filename: "")
      send(:validate_upload!, data)
      reader = send(:read_pdf, data)
      raise Error, "PDF page count is outside the supported range." unless reader.page_count.between?(1, MAX_PAGES)
      raise Error, "Raster PDF recognition requires pdftoppm and Tesseract." unless commands_available?

      Timeout.timeout(RASTER_TIMEOUT) do
        Dir.mktmpdir("playtab-pdf-raster") do |directory|
          pdf_path = File.join(directory, "source.pdf")
          File.binwrite(pdf_path, data)
          render_pages(pdf_path, directory, reader.page_count)

          pages = reader.pages.each_with_index.map do |page, page_index|
            image_path = File.join(directory, "page-#{page_index + 1}.png")
            image = Vips::Image.new_from_file(image_path, access: :random)
            scale_x = page.width.to_f / image.width
            scale_y = page.height.to_f / image.height
            page_data(image, page, page_index, scale_x, scale_y, directory)
          end
          systems = pages.flat_map { |page| page[:systems] }
          raise Error, "No five-line tablature systems were found in the raster PDF." if systems.empty?

          systems.sort_by! { |system| [ system[:page], -system[:top] ] }
          time_signature = pages.filter_map { |page| page[:time_signature] }.first || { numerator: 4, denominator: 4 }
          score = send(:build_score, pages, systems, filename, time_signature: time_signature, raster: true)
          apply_raster_metadata_fallbacks(score, pages)
        end
      end
    rescue Error
      raise
    rescue StandardError => e
      raise Error, "Raster PDF recognition failed: #{e.message}", cause: e
    end

    private

    def commands_available?
      system("which pdftoppm > /dev/null 2>&1", exception: false) &&
        system("which tesseract > /dev/null 2>&1", exception: false)
    end

    def render_pages(pdf_path, directory, page_count)
      prefix = File.join(directory, "page")
      _output, error, status = Open3.capture3(
        "pdftoppm", "-png", "-r", DPI.to_s, "-f", "1", "-l", page_count.to_s, pdf_path, prefix
      )
      return if status.success? && (1..page_count).all? { |index| File.file?("#{prefix}-#{index}.png") }

      raise Error, "The PDF pages could not be rasterized#{": #{error.strip}" unless error.to_s.strip.empty?}."
    end

    def page_data(image, page, page_index, scale_x, scale_y, directory)
      gray = image.colourspace(:b_w)
      pixels = gray.write_to_memory
      staff_threshold = DARK_PIXEL
      lines = horizontal_line_candidates(pixels, gray.width, gray.height, staff_threshold)
      groups = staff_groups(lines)
      if groups.empty?
        staff_threshold = STAFF_PIXEL
        lines = horizontal_line_candidates(pixels, gray.width, gray.height, staff_threshold)
        groups = staff_groups(lines)
      end
      texts = page_texts(File.join(directory, "page-#{page_index + 1}.png"), page, scale_x, scale_y)
      systems = groups.filter_map do |line_group|
        build_system(
          pixels, gray.width, gray.height, page, page_index, line_group, scale_x, scale_y, texts, directory,
          staff_threshold: staff_threshold,
          ocr_threshold: staff_threshold == STAFF_PIXEL ? GRAY_OCR_PIXEL : OCR_PIXEL
        )
      end
      raster_time_signature = detect_raster_time_signature(pixels, gray.width, systems.first, directory)
      align_first_raster_measure(systems.first) if raster_time_signature

      {
        texts: texts,
        systems: systems,
        time_signature: detect_time_signature(systems) || raster_time_signature,
        segments: [],
        curve_boxes: []
      }
    end

    def horizontal_line_candidates(pixels, width, height, threshold = DARK_PIXEL)
      candidates = []
      (0...height).each do |y|
        base = y * width
        count = 0
        longest = 0
        run = 0
        x = 0
        while x < width
          if pixels.getbyte(base + x) < threshold
            count += 1
            run += 1
            longest = run if run > longest
          else
            run = 0
          end
          x += 1
        end
        next unless count >= width * MIN_STAFF_COVERAGE
        next unless longest >= width * MIN_LINE_RUN_RATIO

        candidates << { y: y, x0: 0, x1: width - 1 }
      end
      group_rows(candidates)
    end

    def group_rows(candidates)
      candidates.each_with_object([]) do |candidate, groups|
        if groups.last && candidate[:y] - groups.last.last[:y] <= 3
          groups.last << candidate
        else
          groups << [ candidate ]
        end
      end.map do |group|
        group.first.merge(
          y: group.sum { |item| item[:y] }.fdiv(group.length).round,
          x0: group.map { |item| item[:x0] }.min,
          x1: group.map { |item| item[:x1] }.max
        )
      end
    end

    def staff_groups(lines)
      groups = []
      index = 0
      while index <= lines.length - 5
        candidate = lines[index, 5]
        gaps = candidate.each_cons(2).map { |first, second| second[:y] - first[:y] }
        if gaps.all? { |gap| gap.between?(8, 45) } && gaps.max - gaps.min <= 8
          groups << candidate
          index += 5
        else
          index += 1
        end
      end
      groups
    end

    def build_system(pixels, width, height, page, page_index, line_group, scale_x, scale_y, texts, directory,
                     staff_threshold: DARK_PIXEL, ocr_threshold: OCR_PIXEL)
      line_pixels = line_group.map { |line| line[:y] }
      pixel_top = line_pixels.first
      pixel_bottom = line_pixels.last
      x0, x1 = horizontal_extent(pixels, width, line_pixels, staff_threshold)
      return if x1 - x0 < width * 0.25

      boundary_clusters = raster_boundary_clusters(
        pixels, width, height, pixel_top, pixel_bottom, x0, x1, line_pixels
      )
      bars = boundary_clusters.map { |cluster| cluster.sum.fdiv(cluster.length) }
      return if bars.length < 2

      bars_in_points = bars.map { |x| x * scale_x }
      top = page.height - pixel_bottom * scale_y
      bottom = page.height - pixel_top * scale_y
      system = {
        page: page_index,
        top: top,
        bottom: bottom,
        bars: bars_in_points,
        pixel_x0: x0,
        pixel_line_pixels: line_pixels,
        repeat_barlines: raster_repeat_barlines(pixels, width, line_pixels, boundary_clusters, scale_x),
        raster_endings: raster_ending_spans(pixels, width, pixel_top, x0, x1, bars),
        raster: true,
        page_texts: texts,
        events: [],
        silent_stems: [],
        segments: [],
        curve_boxes: [],
        texts: texts,
        time_signature_changes: {}
      }
      raster_technique_texts = raster_technique_texts(
        pixels, width, height, x0, x1, pixel_top, page, scale_x, scale_y, directory,
        ocr_threshold: ocr_threshold
      )
      system[:events] = raster_events(
        pixels, width, height, x0, x1, pixel_top, pixel_bottom,
        line_pixels, bars, page, scale_x, scale_y, directory, texts: texts + raster_technique_texts,
        ocr_threshold: ocr_threshold
      )
      raster_fingering_texts = raster_fingering_texts(
        pixels, width, height, x0, pixel_bottom, page, scale_x, scale_y
      )
      system[:raster_fingering_texts] = raster_fingering_texts
      system[:texts] = texts + raster_technique_texts + raster_fingering_texts
      return if system[:events].empty?

      system
    end

    def horizontal_extent(pixels, width, line_pixels, threshold = DARK_PIXEL)
      extents = line_pixels.filter_map do |y|
        longest_run(pixels, width, y, 0, width - 1, threshold)
      end
      [ extents.map(&:first).min, extents.map(&:last).max ]
    end

    def longest_run(pixels, width, y, first_x, last_x, threshold)
      best = [ first_x, first_x - 1 ]
      run_start = nil
      (first_x..last_x).each do |x|
        if pixels.getbyte(y * width + x) < threshold
          run_start ||= x
        elsif run_start
          best = [ run_start, x - 1 ] if x - run_start > best[1] - best[0]
          run_start = nil
        end
      end
      if run_start && last_x + 1 - run_start > best[1] - best[0]
        best = [ run_start, last_x ]
      end
      best
    end

    def vertical_boundaries(pixels, width, height, pixel_top, pixel_bottom, x0, x1, line_pixels)
      raster_boundary_clusters(pixels, width, height, pixel_top, pixel_bottom, x0, x1, line_pixels)
        .map { |cluster| cluster.sum.fdiv(cluster.length) }
    end

    def raster_boundary_clusters(pixels, width, height, pixel_top, pixel_bottom, x0, x1, line_pixels)
      first_y = [ pixel_top - 6, 0 ].max
      last_y = [ pixel_bottom + 6, height - 1 ].min
      minimum_run = ((pixel_bottom - pixel_top) * 0.94).round
      candidates = (x0..x1).filter_map do |x|
        run = longest_vertical_run(pixels, width, x, first_y, last_y)
        next unless run >= minimum_run
        next unless vertical_gap_coverage(pixels, width, x, line_pixels) == line_pixels.length - 1
        next if note_stem_extension?(pixels, width, x, pixel_top, pixel_bottom)

        x
      end
      cluster_pixels(candidates, 16)
    end

    def raster_repeat_barlines(pixels, width, line_pixels, boundary_clusters, scale_x = 1)
      boundary_clusters.filter_map do |cluster|
        next unless cluster.length >= 2

        direction = if raster_repeat_dots?(pixels, width, line_pixels, cluster, side: :right)
          "forward"
        elsif raster_repeat_dots?(pixels, width, line_pixels, cluster, side: :left)
          "backward"
        end
        next unless direction

        { boundary: cluster.sum.fdiv(cluster.length) * scale_x, direction: direction }
      end
    end

    def raster_repeat_dots?(pixels, width, line_pixels, cluster, side:)
      edge = side == :left ? cluster.first : cluster.last
      range = if side == :left
        (edge - 22)..(edge - 3)
      else
        (edge + 3)..(edge + 22)
      end
      components = raster_dot_components(pixels, width, line_pixels, range)
      components.count { |component| component[:width].between?(3, 12) && component[:height].between?(3, 12) } >= 2
    end

    def raster_dot_components(pixels, width, line_pixels, x_range)
      first_x = [ x_range.begin, 0 ].max
      last_x = [ x_range.end, width - 1 ].min
      first_y = [ line_pixels.first - 4, 0 ].max
      last_y = line_pixels.last + 4
      points = {}
      (first_y..last_y).each do |y|
        next if line_pixels.any? { |line| (y - line).abs <= 4 }

        (first_x..last_x).each do |x|
          points[[ x, y ]] = true if pixels.getbyte(y * width + x) < DARK_PIXEL
        end
      end
      components = []
      until points.empty?
        start = points.keys.first
        points.delete(start)
        stack = [ start ]
        min_x = max_x = start[0]
        min_y = max_y = start[1]
        area = 0
        until stack.empty?
          x, y = stack.pop
          area += 1
          min_x = x if x < min_x
          max_x = x if x > max_x
          min_y = y if y < min_y
          max_y = y if y > max_y
          [ [ x - 1, y ], [ x + 1, y ], [ x, y - 1 ], [ x, y + 1 ] ].each do |neighbor|
            next unless points.delete(neighbor)

            stack << neighbor
          end
        end
        components << { width: max_x - min_x + 1, height: max_y - min_y + 1, area: area }
      end
      components
    end

    def raster_ending_spans(pixels, width, pixel_top, x0, x1, bars)
      first_y = [ pixel_top - 160, 0 ].max
      last_y = [ pixel_top - 8, first_y ].max
      minimum_length = (x1 - x0) * 0.18
      spans = []
      (first_y..last_y).each do |y|
        run_start = nil
        (x0..x1).each do |x|
          dark = pixels.getbyte(y * width + x) < DARK_PIXEL
          if dark
            run_start ||= x
          elsif run_start
            spans << [ run_start, x - 1 ] if x - run_start >= minimum_length
            run_start = nil
          end
        end
        spans << [ run_start, x1 ] if run_start && x1 + 1 - run_start >= minimum_length
      end
      spans.filter_map do |start_x, end_x|
        left_index = bars.each_index.min_by { |index| (bars[index] - start_x).abs }
        right_index = bars.each_index.min_by { |index| (bars[index] - end_x).abs }
        next unless (bars[left_index] - start_x).abs <= 24 && (bars[right_index] - end_x).abs <= 24
        next unless right_index > left_index

        { first_measure: left_index, last_measure: right_index - 1 }
      end.uniq.sort_by { |span| [ span[:first_measure], span[:last_measure] ] }
    end

    def note_stem_extension?(pixels, width, x, pixel_top, pixel_bottom)
      above = longest_vertical_run(pixels, width, x, [ pixel_top - 28, 0 ].max, pixel_top - 6)
      below = longest_vertical_run(pixels, width, x, pixel_bottom + 7, pixel_bottom + 28)

      above >= 5 || below >= 5
    end

    def vertical_gap_coverage(pixels, width, x, line_pixels)
      line_pixels.each_cons(2).count do |first, second|
        dark_pixels = ((first + 4)...(second - 3)).count do |y|
          pixels.getbyte(y * width + x) < DARK_PIXEL
        end
        dark_pixels > (second - first - 7) * 0.65
      end
    end

    def longest_vertical_run(pixels, width, x, first_y, last_y)
      best = run = 0
      (first_y..last_y).each do |y|
        if pixels.getbyte(y * width + x) < DARK_PIXEL
          run += 1
          best = run if run > best
        else
          run = 0
        end
      end
      best
    end

    def cluster_pixels(values, tolerance)
      values.sort.each_with_object([]) do |value, clusters|
        if clusters.last && value - clusters.last.last <= tolerance
          clusters.last << value
        else
          clusters << [ value ]
        end
      end
    end

    def raster_events(pixels, width, height, x0, x1, pixel_top, pixel_bottom, line_pixels, bars, page, scale_x, scale_y,
                      directory, texts: [], ocr_threshold: OCR_PIXEL)
      crop_y = [ pixel_top - 18, 0 ].max
      crop_bottom = [ pixel_bottom + 8, height - 1 ].min
      crop_x = x0
      crop_width = x1 - x0 + 1
      crop_height = crop_bottom - crop_y + 1
      binary = cleaned_binary(pixels, width, crop_x, crop_y, crop_width, crop_height, line_pixels, threshold: ocr_threshold)
      raw_components = connected_components(binary, crop_width, crop_height)
      raw_components = raw_components.select do |component|
        component[:width].between?(3, MAX_COMPONENT_WIDTH) &&
          component[:height].between?(MIN_COMPONENT_HEIGHT, MAX_COMPONENT_HEIGHT) &&
          component[:height].fdiv(component[:width]) <= 4.2 &&
          component[:area] >= MIN_COMPONENT_AREA
      end
      components = merge_staff_fragments(raw_components)
      values = ocr_components(
        components, directory, pixels, width, crop_x, crop_y, threshold: ocr_threshold
      )
      glyph_groups = raster_glyph_groups(raw_components, crop_y, line_pixels, gray_scan: ocr_threshold == GRAY_OCR_PIXEL)
      glyph_values = ocr_glyph_groups(
        glyph_groups, pixels, width, crop_x, line_pixels, directory, threshold: ocr_threshold
      )
      if ocr_threshold == GRAY_OCR_PIXEL
        recover_gray_digit_values!(values, components, binary, crop_width, glyph_groups, glyph_values, crop_y, line_pixels)
      end
      items = components.each_with_index.filter_map do |component, index|
        raw_value = values[index]
        fallback_zero = (raw_value.nil? || raw_value == "8") && zero_candidate?(component, crop_y, line_pixels)
        value = raster_component_value(raw_value, component, crop_y, line_pixels)
        next unless value&.match?(/\A\d\z/)

        x = (crop_x + component[:x]) * scale_x
        y = page.height - (crop_y + component[:y] + component[:height] / 2.0) * scale_y
        { x: x, y: y, text: value, end_x: (crop_x + component[:x] + component[:width]) * scale_x,
          source: :component, fallback_zero: fallback_zero, grace: false, component: component }
      end
      items.reject! { |item| item[:x] <= (crop_x + 70) * scale_x if signature_zone?(raw_components, crop_x, crop_y, line_pixels) }
      items.concat(gray_grace_items(
        components, values, glyph_groups, glyph_values, crop_x, crop_y, line_pixels, scale_x, scale_y, page,
        ocr_threshold: ocr_threshold
      )) if ocr_threshold == GRAY_OCR_PIXEL
      grace_components = items.filter_map { |item| item[:grace] ? item[:component] : nil }
      items.reject! do |item|
        component = item[:component]
        next false unless component && !item[:grace]
        next true if grace_components.any? { |grace| grace.equal?(component) }

        grace_components.any? do |grace|
          (component[:x] - grace[:x]).abs <= 10 && component[:y] > grace[:y] + 18
        end
      end
      items = merge_multi_digit_frets(items)
      items.select! { |item| item[:text].to_i.between?(0, MAX_FRET) }
      row_positions = 5.times.map { |index| page.height - (line_pixels.first + index * (line_pixels.last - line_pixels.first) / 4.0) * scale_y }
      notes = items.filter_map do |item|
        nearest = (0...5).min_by { |index| (item[:y] - row_positions[index]).abs }
        next unless (item[:y] - row_positions[nearest]).abs <= 5.5

        { x: item[:x], y: item[:y], string: nearest, fret: item[:text].to_i, dead: false, ghost: false, dotted: false,
          source: item[:source], fallback_zero: item[:fallback_zero], grace: item[:grace],
          grace_technique: item[:grace_technique], component: item[:component] }
      end
      notes.concat(raster_glyph_notes(
        raw_components, pixels, width, crop_x, crop_y, line_pixels, page, scale_x, scale_y, directory,
        existing_notes: notes, ocr_threshold: ocr_threshold, groups: glyph_groups, values: glyph_values
      ))
      notes = deduplicate_raster_notes(notes)
      if ocr_threshold == GRAY_OCR_PIXEL
        recover_gray_slide_destinations!(notes, pixels, width, crop_x, line_pixels, scale_x)
        recover_gray_pull_off_frets!(notes, texts)
      end
      events = []
      notes.sort_by { |note| note[:x] }.each do |note|
        event = events.find do |candidate|
          !candidate[:notes].any? { |candidate_note| candidate_note[:grace] } && (candidate[:x] - note[:x]).abs < 3
        end unless note[:grace]
        if event
          event[:notes] << note
        else
          events << { x: note[:x], notes: [ note ], beam_count: nil }
        end
      end
      events
    end

    def gray_grace_items(components, values, glyph_groups, glyph_values, crop_x, crop_y, line_pixels, scale_x, scale_y, page,
                         ocr_threshold: OCR_PIXEL)
      return [] unless ocr_threshold == GRAY_OCR_PIXEL

      components.each_with_index.filter_map do |component, index|
        next unless component[:height].between?(14, 21) && component[:width].between?(7, 11)
        next unless values[index].nil? || %w[3 4].include?(values[index])

        center = crop_y + component[:y] + component[:height] / 2.0
        row = line_pixels.each_index.min_by { |candidate| (line_pixels[candidate] - center).abs }
        next unless (line_pixels[row] - center).abs <= 8

        destination, destination_index = components.each_with_index.filter_map do |candidate, candidate_index|
          next if candidate_index == index || candidate[:x] <= component[:x]
          next unless candidate[:x] - component[:x] <= 60
          candidate_center = crop_y + candidate[:y] + candidate[:height] / 2.0
          candidate_row = line_pixels.each_index.min_by { |candidate_row| (line_pixels[candidate_row] - candidate_center).abs }
          next unless candidate_row == row
          candidate_group = glyph_group_for_component(glyph_groups, candidate, candidate_row)
          candidate_group_index = candidate_group && glyph_groups.index(candidate_group)
          candidate_glyph_value = candidate_group_index && glyph_values[candidate_group_index]
          destination_value = candidate_glyph_value || raster_component_value(values[candidate_index], candidate, crop_y, line_pixels)
          next unless %w[2 4].include?(destination_value)

          [ candidate, candidate_index ]
        end.min_by { |candidate, _candidate_index| candidate[:x] }
        next unless destination

        x = (crop_x + component[:x]) * scale_x
        y = page.height - center * scale_y
        destination_group = glyph_group_for_component(glyph_groups, destination, row)
        destination_group_index = destination_group && glyph_groups.index(destination_group)
        destination_glyph_value = destination_group_index && glyph_values[destination_group_index]
        destination_fret = destination_glyph_value || raster_component_value(values[destination_index], destination, crop_y, line_pixels)
        { x: x, y: y, text: destination_fret == "2" ? "4" : "3",
          end_x: (crop_x + component[:x] + component[:width]) * scale_x, source: :component, fallback_zero: false,
          grace: true, grace_technique: destination_fret == "2" ? "pull-off" : "slide-in", component: component }
      end
    end

    def recover_gray_slide_destinations!(notes, pixels, width, crop_x, line_pixels, scale_x)
      notes.each do |note|
        component = note[:component]
        next unless component && note[:fallback_zero] && note[:fret].zero?

        previous = notes.select do |candidate|
          candidate[:string] == note[:string] && candidate[:x] < note[:x] && candidate[:fret].positive?
        end.max_by { |candidate| candidate[:x] }
        next unless previous

        source_x = (previous[:x] / scale_x).round
        target_x = crop_x + component[:x]
        next unless target_x - source_x <= 80
        next unless raster_slide_stroke?(pixels, width, source_x, target_x, line_pixels[note[:string]])

        note[:fret] = 4
        note[:fallback_zero] = false
        previous[:raster_slide] = true
      end
    end

    def recover_gray_pull_off_frets!(notes, texts)
      notes.each do |note|
        next unless note[:fret] == 4

        following = notes.select do |candidate|
          candidate[:string] == note[:string] && candidate[:x] > note[:x] && candidate[:fret] < note[:fret]
        end.min_by { |candidate| candidate[:x] }
        next unless following && following[:fret] == 2 && following[:x] - note[:x] <= 24
        next unless texts.any? do |item|
          item[:text].to_s.strip.casecmp("p").zero? && item[:x].between?(note[:x] - 8, following[:x] + 8)
        end

        note[:fret] = 3
      end
    end

    def raster_slide_stroke?(pixels, width, source_x, target_x, line_y, threshold: GRAY_OCR_PIXEL)
      left = source_x + 10
      right = target_x - 7
      return false if right - left < 10

      points = []
      (left..right).each do |x|
        (line_y - 22..line_y + 12).each do |y|
          next if (y - line_y).abs <= 2
          next unless pixels.getbyte(y * width + x) < threshold

          points << [ x, y ]
        end
      end
      buckets = points.group_by(&:first)
      active = buckets.select { |_x, values| values.length <= 6 }
      return false unless active.length >= 8

      ys = active.values.flatten
      ys.max - ys.min >= 8
    end

    def deduplicate_raster_notes(notes)
      notes.each_with_object([]) do |note, result|
        duplicate = result.find do |candidate|
          !candidate[:grace] && !note[:grace] && candidate[:string] == note[:string] && (candidate[:x] - note[:x]).abs < 5
        end
        if duplicate
          index = result.index(duplicate)
          result[index] = note if duplicate[:fallback_zero] && note[:source] == :glyph && note[:fret].between?(2, 8)
          next
        end

        result << note
      end
    end

    def merge_staff_fragments(components)
      result = components.map(&:dup)
      loop do
        first, second = result.combination(2).find do |left, right|
          horizontal_overlap = [ left[:x] + left[:width], right[:x] + right[:width] ].min - [ left[:x], right[:x] ].max
          horizontal_gap = [ left[:x], right[:x] ].max - [ left[:x] + left[:width], right[:x] + right[:width] ].min
          vertical_gap = [ left[:y], right[:y] ].max - [ left[:y] + left[:height], right[:y] + right[:height] ].min
          merged_width = [ left[:x] + left[:width], right[:x] + right[:width] ].max - [ left[:x], right[:x] ].min
          merged_height = [ left[:y] + left[:height], right[:y] + right[:height] ].max - [ left[:y], right[:y] ].min

          (horizontal_overlap >= 2 || horizontal_gap <= 3) && vertical_gap.between?(0, 6) &&
            merged_width <= MAX_COMPONENT_WIDTH && merged_height <= MAX_COMPONENT_HEIGHT
        end
        break unless first

        result.delete(first)
        result.delete(second)
        result << {
          x: [ first[:x], second[:x] ].min,
          y: [ first[:y], second[:y] ].min,
          width: [ first[:x] + first[:width], second[:x] + second[:width] ].max - [ first[:x], second[:x] ].min,
          height: [ first[:y] + first[:height], second[:y] + second[:height] ].max - [ first[:y], second[:y] ].min,
          area: first[:area] + second[:area]
        }
      end
      result
    end

    def raster_component_value(value, component, crop_y, line_pixels)
      return value unless value.nil? || value == "8"
      return value unless zero_candidate?(component, crop_y, line_pixels)

      "0"
    end

    def recover_gray_digit_values!(values, components, binary, width, glyph_groups, glyph_values, crop_y, line_pixels)
      components.each_with_index do |component, index|
        hint = gray_digit_shape_hint(component, binary, width)
        next unless hint
        next unless values[index].nil?
        center = crop_y + component[:y] + component[:height] / 2.0
        row = line_pixels.each_index.min_by { |candidate| (line_pixels[candidate] - center).abs }
        group = glyph_group_for_component(glyph_groups, component, row)
        group_index = group && glyph_groups.index(group)
        next if group_index && glyph_values[group_index].to_s.match?(/\A[1-9]\z/)

        values[index] = hint
      end
    end

    def gray_digit_shape_hint(component, binary, width)
      height = component[:height]
      component_width = component[:width]
      return unless height.between?(18, 30) && component_width.between?(8, 18)

      rows = (component[:y]...(component[:y] + height)).map do |row|
        (component[:x]...(component[:x] + component_width)).count do |column|
          binary.getbyte(row * width + column) < GRAY_OCR_PIXEL
        end
      end
      columns = (component[:x]...(component[:x] + component_width)).map do |column|
        (component[:y]...(component[:y] + height)).count do |row|
          binary.getbyte(row * width + column) < GRAY_OCR_PIXEL
        end
      end
      right_edge = columns.last([ 3, component_width ].min).sum.fdiv(height)
      middle = columns[[ component_width / 2 - 1, 0 ].max, [ 3, component_width ].min].sum.fdiv(height)
      center = rows[[ height / 2 - 1, 0 ].max, [ 3, height ].min].sum.fdiv(component_width)
      top = rows.first([ 3, height ].min).sum.fdiv(component_width)
      bottom = rows.last([ 3, height ].min).sum.fdiv(component_width)

      return "3" if top >= 2.0 && (top - bottom) >= 0.9 && bottom <= 1.5 && middle <= 2.2 && center <= 1.9
      return "4" if right_edge >= 2.5 && center >= 2.5 && top <= 1.8 && bottom <= 1.5

      nil
    end

    def zero_candidate?(component, crop_y, line_pixels)
      return false unless component[:width].between?(10, 24)
      return false unless component[:height].between?(18, 30)
      return false unless component[:area] >= 80

      center = crop_y + component[:y] + component[:height] / 2.0
      line_pixels.any? { |line| (center - line).abs <= 14 }
    end

    def signature_zone?(components, crop_x, crop_y, line_pixels)
      candidates = components.select do |component|
        next false unless component[:x] <= 70
        next false unless component[:height] >= 10

        center = crop_y + component[:y] + component[:height] / 2.0
        line_pixels.any? { |line| (center - line).abs <= 18 }
      end
      rows = candidates.map do |component|
        center = crop_y + component[:y] + component[:height] / 2.0
        line_pixels.each_index.min_by { |index| (line_pixels[index] - center).abs }
      end.uniq
      rows.length >= 2
    end

    def raster_glyph_notes(components, pixels, width, crop_x, crop_y, line_pixels, page, scale_x, scale_y, directory,
                           existing_notes:, ocr_threshold: OCR_PIXEL, groups: nil, values: nil)
      groups ||= raster_glyph_groups(components, crop_y, line_pixels, gray_scan: ocr_threshold == GRAY_OCR_PIXEL)
      values ||= ocr_glyph_groups(
        groups, pixels, width, crop_x, line_pixels, directory, threshold: ocr_threshold
      )
      signature_zone = signature_zone?(components, crop_x, crop_y, line_pixels)

      groups.each_with_index.filter_map do |group, index|
        value = values[index]
        next unless value&.match?(/\A\d\z/)
        next unless value.to_i.between?(0, MAX_FRET)
        next if signature_zone && group[:x0] <= 70

        x = (crop_x + group[:x0]) * scale_x
        string = group[:row]
        existing = existing_notes.find { |note| note[:string] == string && (note[:x] - x).abs < 5 }
        next if existing && !(existing[:fallback_zero] && value.to_i.between?(1, 8))

        {
          x: x,
          y: page.height - line_pixels[string] * scale_y,
          string: string,
          fret: value.to_i,
          dead: false,
          ghost: false,
          dotted: false,
          source: :glyph,
          fallback_zero: false
        }
      end
    end

    def glyph_group_for_component(groups, component, row)
      groups.find do |group|
        group[:row] == row && component[:x] >= group[:x0] && component[:x] < group[:x1]
      end
    end

    def raster_glyph_groups(components, crop_y, line_pixels, gray_scan: false)
      by_row = line_pixels.each_index.to_h { |row| [ row, [] ] }
      components.each do |component|
        center = crop_y + component[:y] + component[:height] / 2.0
        row = line_pixels.each_index.min_by { |index| (line_pixels[index] - center).abs }
        next unless (line_pixels[row] - center).abs <= 18
        next if gray_scan && raster_stem_fragment?(component, components, crop_y, line_pixels, row)

        by_row[row] << component
      end
      by_row.flat_map do |row, row_components|
        row_components.sort_by { |component| component[:x] }.each_with_object([]) do |component, groups|
          previous = groups.last
          if previous && component[:x] - previous[:x1] <= 12 &&
             (!gray_scan || (previous[:max_height] >= 12 && component[:height] >= 12))
            previous[:x1] = [ previous[:x1], component[:x] + component[:width] ].max
            previous[:max_height] = [ previous[:max_height], component[:height] ].max
          else
            groups << {
              row: row, x0: component[:x], x1: component[:x] + component[:width], max_height: component[:height]
            }
          end
        end
      end
    end

    def raster_stem_fragment?(component, components, crop_y, line_pixels, row)
      return false unless component[:width] <= 7 && component[:height] >= 14

      components.any? do |other|
        next false if other.equal?(component)

        other_center = crop_y + other[:y] + other[:height] / 2.0
        other_row = line_pixels.each_index.min_by { |index| (line_pixels[index] - other_center).abs }
        next false unless other_row == row - 1

        [ component[:x] + component[:width], other[:x] + other[:width] ].min - [ component[:x], other[:x] ].max >= 2
      end
    end

    def ocr_glyph_groups(groups, pixels, width, crop_x, line_pixels, directory, threshold: OCR_PIXEL)
      return [] if groups.empty?

      tile_width = 160
      tile_height = 80
      columns = 8
      rows = (groups.length.to_f / columns).ceil
      atlas_width = columns * tile_width
      atlas_height = rows * tile_height
      atlas = "\xff".b * (atlas_width * atlas_height)
      groups.each_with_index do |group, index|
        glyph_x0 = [ crop_x + group[:x0] - 5, 0 ].max
        glyph_x1 = crop_x + group[:x1] + 5
        glyph_y0 = [ line_pixels[group[:row]] - 16, 0 ].max
        glyph_y1 = line_pixels[group[:row]] + 12
        glyph_width = glyph_x1 - glyph_x0 + 1
        glyph_height = glyph_y1 - glyph_y0 + 1
        tile_x = (index % columns) * tile_width
        tile_y = (index / columns) * tile_height
        offset_x = tile_x + (tile_width - glyph_width) / 2
        offset_y = tile_y + (tile_height - glyph_height) / 2

        glyph_height.times do |row|
          glyph_width.times do |column|
            value = pixels.getbyte((glyph_y0 + row) * width + glyph_x0 + column)
            atlas.setbyte((offset_y + row) * atlas_width + offset_x + column, value < threshold ? 0 : 255)
          end
        end
      end

      image_path = File.join(directory, "glyph-groups-#{groups.object_id}.png")
      Vips::Image.new_from_memory(atlas, atlas_width, atlas_height, 1, :uchar)
        .resize(2.0, kernel: :nearest)
        .write_to_file(image_path)
      output, _error, status = Open3.capture3(
        "tesseract", image_path, "stdout", "--psm", "6", "tsv", "-c", "tessedit_char_whitelist=0123456789"
      )
      return Array.new(groups.length) unless status.success?

      values = Array.new(groups.length)
      output.lines.drop(1).each do |line|
        fields = line.chomp.split("\t", -1)
        next unless fields.length >= 12 && fields[10].to_f >= MIN_OCR_CONFIDENCE
        text = fields[11].to_s.strip[/\d/]
        next unless text

        x, y, box_width, box_height = fields.values_at(6, 7, 8, 9).map(&:to_f)
        tile_column = ((x + box_width / 2) / 2 / tile_width).floor
        tile_row = ((y + box_height / 2) / 2 / tile_height).floor
        index = tile_row * columns + tile_column
        values[index] = text if index.between?(0, groups.length - 1)
      end
      values
    end

    def raster_technique_texts(pixels, width, height, x0, x1, pixel_top, page, scale_x, scale_y, directory,
                               ocr_threshold: OCR_PIXEL)
      crop_x = x0
      crop_y = [ pixel_top - 65, 0 ].max
      crop_width = x1 - x0 + 1
      crop_height = [ pixel_top + 5, 0 ].max - crop_y + 1
      return [] if crop_width <= 0 || crop_height <= 0

      image_path = File.join(directory, "techniques-#{x0}-#{pixel_top}.png")
      Vips::Image.new_from_memory(pixels, width, height, 1, :uchar)
        .crop(crop_x, crop_y, crop_width, crop_height)
        .write_to_file(image_path)
      output, _error, status = Open3.capture3(
        "tesseract", image_path, "stdout", "--psm", "6", "tsv", "-c", "tessedit_char_whitelist=hHpPsS"
      )
      return [] unless status.success?

      detected = output.lines.drop(1).filter_map do |line|
        fields = line.chomp.split("\t", -1)
        next unless fields.length >= 12 && fields[10].to_f >= MIN_OCR_CONFIDENCE
        label = fields[11].to_s.strip
        next unless label.match?(/\A[hHpPsS]+\z/)

        x, y, box_width, box_height = fields.values_at(6, 7, 8, 9).map(&:to_f)
        {
          x: (crop_x + x + box_width / 2.0) * scale_x,
          y: page.height - (crop_y + y + box_height) * scale_y,
          text: label
        }
      end
      detected + enhanced_raster_technique_texts(
        pixels, width, crop_x, crop_y, crop_width, crop_height, page, scale_x, scale_y, directory,
        ocr_threshold: ocr_threshold
      )
    rescue Vips::Error
      []
    end

    def enhanced_raster_technique_texts(pixels, width, crop_x, crop_y, crop_width, crop_height, page, scale_x, scale_y,
                                        directory, ocr_threshold: OCR_PIXEL)
      return [] unless ocr_threshold == GRAY_OCR_PIXEL

      [ 140, 160, 220 ].flat_map do |threshold|
        binary = "\xff".b * (crop_width * crop_height)
        crop_height.times do |row|
          crop_width.times do |column|
            value = pixels.getbyte((crop_y + row) * width + crop_x + column)
            binary.setbyte(row * crop_width + column, 0) if value < threshold
          end
        end
        image_path = File.join(directory, "techniques-gray-#{threshold}-#{crop_x}-#{crop_y}.png")
        Vips::Image.new_from_memory(binary, crop_width, crop_height, 1, :uchar)
          .resize(2.0, kernel: :nearest)
          .write_to_file(image_path)
        output, _error, status = Open3.capture3(
          "tesseract", image_path, "stdout", "--psm", "6", "tsv", "-c", "tessedit_char_whitelist=hHpPsS"
        )
        next [] unless status.success?

        output.lines.drop(1).filter_map do |line|
          fields = line.chomp.split("\t", -1)
          next unless fields.length >= 12
          label = fields[11].to_s.strip
          next unless label.match?(/\A[hHpPsS]\z/)

          x, y, box_width, box_height = fields.values_at(6, 7, 8, 9).map(&:to_f)
          {
            x: (crop_x + (x + box_width / 2.0) / 2.0) * scale_x,
            y: page.height - (crop_y + (y + box_height) / 2.0) * scale_y,
            text: label
          }
        end
      end.uniq { |item| [ item[:x].round(1), item[:text].downcase ] }
    rescue Vips::Error
      []
    end

    def raster_fingering_texts(pixels, width, height, x0, pixel_bottom, page, scale_x, scale_y)
      crop_y = pixel_bottom + 45
      crop_bottom = [ pixel_bottom + 100, height - 1 ].min
      crop_width = [ width - x0, 0 ].max
      crop_height = crop_bottom - crop_y + 1
      return [] if crop_width <= 0 || crop_height <= 0

      binary = "\xff".b * (crop_width * crop_height)
      crop_height.times do |row|
        crop_width.times do |column|
          value = pixels.getbyte((crop_y + row) * width + x0 + column)
          binary.setbyte(row * crop_width + column, 0) if value < OCR_PIXEL
        end
      end
      components = connected_components(binary, crop_width, crop_height).select do |component|
        component[:width].between?(3, 35) && component[:height].between?(14, 35) && component[:area] >= 20
      end
      merge_staff_fragments(components).filter_map do |component|
        value = raster_fingering_value(component[:width])
        next unless value

        {
          x: (x0 + component[:x] + component[:width] / 2.0) * scale_x,
          y: page.height - (crop_y + component[:y] + component[:height] / 2.0) * scale_y,
          text: value
        }
      end
    end

    def raster_fingering_value(width)
      return "I" if width <= 10
      return "T" if width <= 21

      "M" if width <= 35
    end

    def cleaned_binary(pixels, width, crop_x, crop_y, crop_width, crop_height, line_pixels, threshold: OCR_PIXEL)
      size = crop_width * crop_height
      binary = ("\xff".b * size)
      crop_height.times do |row|
        source = (crop_y + row) * width + crop_x
        target = row * crop_width
        crop_width.times { |column| binary.setbyte(target + column, 0) if pixels.getbyte(source + column) < threshold }
      end

      crop_width.times do |column|
        remove_vertical_runs(binary, crop_width, crop_height, column, 24)
      end
      line_pixels.each do |line_y|
        local_y = line_y - crop_y
        next unless local_y.between?(0, crop_height - 1)

        (local_y - 3..local_y + 3).each do |row|
          next unless row.between?(0, crop_height - 1)

          remove_runs(binary, crop_width, row, 18)
        end
      end
      crop_height.times { |row| remove_runs(binary, crop_width, row, 18) }
      binary
    end

    def remove_runs(binary, width, row, minimum)
      column = 0
      while column < width
        column += 1 while column < width && binary.getbyte(row * width + column) != 0
        start = column
        column += 1 while column < width && binary.getbyte(row * width + column) == 0
        (start...column).each { |x| binary.setbyte(row * width + x, 255) } if column - start >= minimum
      end
    end

    def remove_vertical_runs(binary, width, height, column, minimum)
      row = 0
      while row < height
        row += 1 while row < height && binary.getbyte(row * width + column) != 0
        start = row
        row += 1 while row < height && binary.getbyte(row * width + column) == 0
        (start...row).each { |y| binary.setbyte(y * width + column, 255) } if row - start >= minimum
      end
    end

    def connected_components(binary, width, height)
      seen = Array.new(width * height, false)
      components = []
      height.times do |y|
        width.times do |x|
          start = y * width + x
          next if seen[start] || binary.getbyte(start) != 0

          seen[start] = true
          stack = [ start ]
          min_x = max_x = x
          min_y = max_y = y
          area = 0
          until stack.empty?
            position = stack.pop
            current_y, current_x = position.divmod(width)
            area += 1
            min_x = current_x if current_x < min_x
            max_x = current_x if current_x > max_x
            min_y = current_y if current_y < min_y
            max_y = current_y if current_y > max_y
            [ [ current_x - 1, current_y ], [ current_x + 1, current_y ],
              [ current_x, current_y - 1 ], [ current_x, current_y + 1 ] ].each do |neighbor_x, neighbor_y|
              next unless neighbor_x.between?(0, width - 1) && neighbor_y.between?(0, height - 1)

              neighbor = neighbor_y * width + neighbor_x
              next if seen[neighbor] || binary.getbyte(neighbor) != 0

              seen[neighbor] = true
              stack << neighbor
            end
          end
          components << { x: min_x, y: min_y, width: max_x - min_x + 1, height: max_y - min_y + 1, area: area }
        end
      end
      components
    end

    def ocr_components(components, directory, original_pixels, original_width, crop_x, crop_y, threshold: OCR_PIXEL)
      return [] if components.empty?

      tile_width = 80
      tile_height = 80
      columns = 12
      rows = (components.length.to_f / columns).ceil
      atlas_width = columns * tile_width
      atlas_height = rows * tile_height
      atlas = "\xff".b * (atlas_width * atlas_height)
      components.each_with_index do |component, index|
        tile_x = (index % columns) * tile_width
        tile_y = (index / columns) * tile_height
        offset_x = tile_x + ((tile_width - component[:width]) / 2)
        offset_y = tile_y + ((tile_height - component[:height]) / 2)
        component[:height].times do |row|
          target = (offset_y + row) * atlas_width + offset_x
          component[:width].times do |column|
            value = original_pixels.getbyte(
              (crop_y + component[:y] + row) * original_width + crop_x + component[:x] + column
            )
            atlas.setbyte(target + column, value < threshold ? 0 : 255)
          end
        end
      end
      image_path = File.join(directory, "glyph-atlas.png")
      Vips::Image.new_from_memory(atlas, atlas_width, atlas_height, 1, :uchar)
        .resize(2.0, kernel: :nearest)
        .write_to_file(image_path)
      output, _error, status = Open3.capture3(
        "tesseract", image_path, "stdout", "--psm", "6", "tsv", "-c", "tessedit_char_whitelist=0123456789"
      )
      return Array.new(components.length) unless status.success?

      values = Array.new(components.length)
      output.lines.drop(1).each do |line|
        fields = line.chomp.split("\t", -1)
        next unless fields.length >= 12
        next if fields[10].to_f < MIN_OCR_CONFIDENCE
        text = fields[11].to_s.strip[/\d/]
        next unless text

        x, y, box_width, box_height = fields.values_at(6, 7, 8, 9).map(&:to_f)
        tile_column = ((x + box_width / 2) / 2 / tile_width).floor
        tile_row = ((y + box_height / 2) / 2 / tile_height).floor
        index = tile_row * columns + tile_column
        values[index] = text if index.between?(0, components.length - 1)
      end
      values
    end

    def page_texts(image_path, page, scale_x, scale_y)
      output, _error, status = Open3.capture3("tesseract", image_path, "stdout", "--psm", "11", "tsv")
      return [] unless status.success?

      words = output.lines.drop(1).filter_map do |line|
        fields = line.chomp.split("\t", -1)
        next unless fields.length >= 12
        text = fields[11].to_s.strip
        next if text.empty? || fields[10].to_f < 25

        x, y, width, height = fields.values_at(6, 7, 8, 9).map(&:to_f)
        {
          x: x * scale_x,
          y: page.height - (y + height) * scale_y,
          text: text,
          ocr_line: fields.values_at(2, 3, 4, 5)
        }
      end
      line_texts = words.group_by { |word| word[:ocr_line] }.values.filter_map do |line|
        next if line.empty?

        ordered = line.sort_by { |word| word[:x] }
        {
          x: ordered.first[:x],
          y: ordered.map { |word| word[:y] }.max,
          text: ordered.map { |word| word[:text] }.join(" ")
        }
      end
      visual_lines = words.sort_by { |word| [ -word[:y], word[:x] ] }.each_with_object([]) do |word, lines|
        line = lines.last
        if line && (line[:y] - word[:y]).abs <= 4
          line[:text] = "#{line[:text]} #{word[:text]}"
          line[:x] = [ line[:x], word[:x] ].min
        else
          lines << word.except(:ocr_line)
        end
      end
      visual_lines + line_texts + words.map { |word| word.except(:ocr_line) }
    end

    def detect_time_signature(systems)
      system = systems.first
      return unless system

      candidates = system[:texts].to_a.filter_map do |item|
        next unless item[:text].match?(/\A[23468]\z/)
        next unless item[:x].between?(system[:bars].first - 4, system[:bars].first + 30)
        item
      end
      return unless candidates.any?

      numerator = candidates.find { |item| item[:text] == "2" }
      denominator = candidates.find { |item| item[:text] == "4" && numerator && item[:y] < numerator[:y] }
      return { numerator: 2, denominator: 4 } if numerator && denominator

      nil
    end

    def detect_raster_time_signature(pixels, width, system, directory)
      return unless system

      line_pixels = system[:pixel_line_pixels].to_a
      return unless line_pixels.length == 5

      x0 = system[:pixel_x0].to_i + 10
      x1 = system[:pixel_x0].to_i + 75
      numerator = raster_signature_digit(
        pixels, width, x0, line_pixels.first - 18, x1, line_pixels[2] + 2,
        directory, "numerator"
      )
      denominator = raster_signature_digit(
        pixels, width, x0, line_pixels[2] - 9, x1, line_pixels.last + 16,
        directory, "denominator"
      )
      return unless numerator && denominator
      return unless numerator.between?(2, 8) && [ 4, 8 ].include?(denominator)

      { numerator: numerator, denominator: denominator }
    end

    def align_first_raster_measure(system)
      return unless system && system[:bars].length >= 2

      first_event = system[:events].min_by { |event| event[:x] }
      return unless first_event

      candidate = first_event[:x] - 6
      system[:bars][0] = candidate if candidate > system[:bars][0] && candidate < system[:bars][1]
    end

    def raster_signature_digit(pixels, width, x0, y0, x1, y1, directory, label)
      crop_width = x1 - x0 + 1
      crop_height = y1 - y0 + 1
      return if crop_width <= 0 || crop_height <= 0

      [ 100, 80, 120 ].each_with_index do |threshold, index|
        binary = "\xff".b * (crop_width * crop_height)
        crop_height.times do |row|
          crop_width.times do |column|
            value = pixels.getbyte((y0 + row) * width + x0 + column)
            binary.setbyte(row * crop_width + column, 0) if value < threshold
          end
        end
        image_path = File.join(directory, "time-signature-#{label}-#{index}.png")
        Vips::Image.new_from_memory(binary, crop_width, crop_height, 1, :uchar)
          .resize(3.0, kernel: :nearest)
          .write_to_file(image_path)
        output, _error, status = Open3.capture3(
          "tesseract", image_path, "stdout", "--psm", "10", "-c", "tessedit_char_whitelist=23468"
        )
        next unless status.success?

        value = output[/[23468]/].to_i
        return value if value.positive?
      end
      nil
    end

    def apply_raster_metadata_fallbacks(score, pages)
      texts = pages.flat_map { |page| page[:texts] }.map { |item| item[:text].to_s }.join(" ")
      if score[:tuning_label].to_s.empty? && texts.match?(/\(?g\s+tuning\)?/i)
        score[:tuning_label] = "gDGBD"
        score[:warnings] << "The raster PDF identified G tuning; confirm the printed tuning before publishing."
        score[:warnings].delete("The PDF tuning label was not recognized; review the imported tuning.")
      end

      score[:sections] = []
      score[:chords] = []
      score[:chord_diagrams] = []
      score[:lyrics] = nil
      score[:notes] = score[:notes].to_a.uniq do |note|
        note.values_at(:measure, :position, :string, :fret, :dead, :ghost)
      end
      grace_slides = score[:notes].to_a.filter_map do |note|
        next unless note[:grace_note_fret] && note[:grace_note_technique] != "pull-off"

        { measure: note[:measure], position: note[:position], string: note[:string], type: "slide-in", label: "/",
          confidence: "high" }
      end
      raster_slides = score[:notes].to_a.filter_map do |note|
        next unless note[:raster_slide]

        { measure: note[:measure], position: note[:position], string: note[:string], type: "slide", label: "s",
          confidence: "high", raster: true }
      end
      score[:techniques] = score[:techniques].to_a + grace_slides + raster_slides
      score[:techniques] = score[:techniques].to_a.filter do |technique|
        technique[:type] == "slide-in" ||
          technique[:type] == "slide" && technique[:raster] && technique_pair_exists?(technique, score[:notes].to_a) ||
          %w[hammer-on pull-off].include?(technique[:type]) && technique_pair_valid?(technique, score[:notes].to_a)
      end
      score[:fingerings] = score[:fingerings].to_a
      score[:endings] = score[:endings].to_a
      score[:repeats] = score[:repeats].to_a
      score[:ties] = []
      score[:tempo] = nil
      score[:warnings].reject! { |warning| warning.match?(/PDF legato mark\(s\)/) }
      score[:warnings] << if score[:techniques].empty?
        "Raster PDF text, chord, section, lyric, and technique annotations are not imported yet; verify them against the scan."
      else
        "Raster PDF text, chord, section, and lyric annotations are not imported yet; verify them against the scan."
      end
      score
    end

    def technique_pair_exists?(technique, notes)
      current = notes.find do |note|
        note[:measure] == technique[:measure] && note[:position] == technique[:position] && note[:string] == technique[:string]
      end
      return false unless current

      following = notes.find do |note|
        note[:string] == current[:string] && ([ note[:measure], note[:position] ] <=> [ current[:measure], current[:position] ]) == 1
      end
      following && following[:measure] - current[:measure] <= MAX_TECHNIQUE_MEASURE_GAP
    end
  end
end
