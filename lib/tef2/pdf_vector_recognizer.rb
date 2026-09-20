# frozen_string_literal: true

require "pdf/reader"
require "open3"
require "stringio"
require "zlib"
require "tempfile"
require "tmpdir"
require "tef2/pdf_recognizer"

module Tef2
  # Recognizes vector-drawing-only tab PDFs (for example Guitar Pro "tab page"
  # exports that draw every digit, staff line, and mark as Bezier paths and
  # carry no selectable text). It recovers the staff geometry, measure
  # boundaries, digit glyphs, chord symbols, technique marks, and ties from
  # the raw drawing data and produces the same score document that
  # PdfRecognizer produces for text-based PDFs.
  class PdfVectorRecognizer
    Error = PdfRecognizer::Error

    MAX_PDF_SIZE = 10_000_000
    MAX_PAGES = 64
    HEADER_RENDER_DPI = 180
    DIGIT_WHITELIST = "0123456789"
    CHORD_WHITELIST = "ABCDEFGm"

    def self.recognize(data, filename: "")
      new.recognize(data, filename: filename)
    end

    def recognize(data, filename: "")
      raise Error, "PDF upload is empty or too large." unless data.is_a?(String) && data.bytesize.between?(1, MAX_PDF_SIZE)
      raise Error, "This file is not a PDF." unless data.start_with?("%PDF-")

      reader = read_pdf(data)
      raise Error, "PDF page count is outside the supported range." unless reader.page_count.between?(1, MAX_PAGES)
      receivers = reader.pages.map do |page|
        receiver = VectorPageReceiver.new
        receiver.page_size = page.attributes[:MediaBox] if page.respond_to?(:attributes)
        page.walk(receiver)
        receiver
      end

      systems = receivers.filter_map { |receiver| recover_staffs(receiver) }.flatten
      if systems.empty?
        raise Error, "No five-line tablature systems were found in the vector data. This PDF may be a scan or an unsupported layout."
      end

      build_score(receivers, systems, filename, data: data)
    rescue Error
      raise
    rescue StandardError => e
      raise Error, "Vector PDF recognition failed: #{e.message}", cause: e
    end

    private

    def read_pdf(data)
      PDF::Reader.new(StringIO.new(data))
    rescue StandardError => e
      raise Error, "This PDF could not be read safely.", cause: e
    end

    # --- staff and measure recovery -------------------------------------

    # Returns the page's five-line systems, each { top:, bottom:, lines:, x0:, x1: }.
    def recover_staffs(receiver)
      lines = horizontal_lines(receiver.segments).sort_by { |line| -line[:y] }

      systems = []
      current = []
      lines.each do |line|
        if current.empty? || current.last[:y] - line[:y] <= 20
          current << line
        else
          systems << current
          current = [ line ]
        end
      end
      systems << current

      systems.filter_map do |group|
        next unless group.length == 5

        {
          top: group.first[:y],
          bottom: group.last[:y],
          lines: group.map { |line| line[:y] },
          x0: group.map { |line| line[:x0] }.min,
          x1: group.map { |line| line[:x1] }.max
        }
      end
    end

    # Groups long horizontal segments into staff lines by y position.
    def horizontal_lines(segments)
      long = segments.select do |x1, y1, x2, y2|
        (y1 - y2).abs < 1.0 && (x2 - x1).abs >= 100
      end

      grouped = []
      long.each do |x1, y1, x2, y2|
        match = grouped.find { |line| (line[:y] - (y1 + y2) / 2.0).abs < 1.5 }
        if match
          match[:x0] = [ match[:x0], x1, x2 ].min
          match[:x1] = [ match[:x1], x1, x2 ].max
        else
          grouped << { y: (y1 + y2) / 2.0, x0: [ x1, x2 ].min, x1: [ x1, x2 ].max }
        end
      end
      grouped
    end

    # Groups full-staff-height vertical segments into barline boundaries.
    def barlines(receiver, system)
      verticals = receiver.segments.filter_map do |x1, y1, x2, y2|
        next unless (x1 - x2).abs < 1.0
        ylo, yhi = [ y1, y2 ].min, [ y1, y2 ].max
        next unless (yhi - ylo) >= 30 && yhi <= system[:top] + 8 && ylo >= system[:bottom] - 8

        (x1 + x2) / 2.0
      end

      grouped = []
      verticals.sort.each do |x|
        match = grouped.index { |edge| (edge - x).abs < 2.5 }
        match.nil? ? grouped << x : grouped[match] = x
      end
      # A double barline (for example the A|B boundary) draws two lines a
      # few points apart; collapse closely-spaced boundaries into one.
      collapsed = []
      grouped.each do |x|
        collapsed.pop if collapsed.last.is_a?(Numeric) && (x - collapsed.last) < 40
        collapsed << x
      end
      [ grouped, collapsed ]
    end

    # --- glyph capture ----------------------------------------------------

    # Captures the page's drawing subpaths (lines and cubic curves) in page
    # coordinates, plus straight segments and curve bounding boxes.
    class VectorPageReceiver < PDF::Reader::PageTextReceiver
      attr_reader :segments, :curve_boxes, :subpaths
      attr_accessor :page_size

      def initialize
        super
        @segments = []
        @curve_boxes = []
        @subpaths = []
        @pending = nil
        @subpath = nil
      end

      def begin_new_subpath(x, y)
        point = state.ctm_transform_point(x, y)
        @pending = [ point.x, point.y ]
        @subpath = { start: [ point.x, point.y ], segments: [], raw: [ [ point.x, point.y ] ] }
      end

      def append_line(x, y)
        point = state.ctm_transform_point(x, y)
        if @pending
          x1, y1 = @pending
          @segments << [ x1, y1, point.x, point.y ]
        end
        if @subpath
          @subpath[:segments] << { kind: :line, x: point.x, y: point.y }
          @subpath[:raw] << [ point.x, point.y ]
        end
        @pending = nil
      end

      def append_curved_segment(x1, y1, x2, y2, x, y)
        record_curve_box(x1, y1, x2, y2, x, y)
        if @subpath
          points = [ [ x1, y1 ], [ x2, y2 ], [ x, y ] ].map { |px, py| state.ctm_transform_point(px, py) }
          @subpath[:segments] << {
            kind: :curve,
            c1x: points[0].x, c1y: points[0].y,
            c2x: points[1].x, c2y: points[1].y,
            x: points[2].x, y: points[2].y
          }
          @subpath[:raw] += points.map { |p| [ p.x, p.y ] }
        end
        @pending = nil
      end

      %i[append_curved_segment_initial_point_replicated
         append_curved_segment_final_point_replicated].each do |name|
        define_method(name) { |*args| append_curved_segment(*args) }
      end

      %i[close_subpath close_and_stroke_path stroke_path fill_path_with_nonzero
         fill_path_with_even_odd close_fill_stroke close_fill_stroke_with_even_odd
         fill_stroke fill_stroke_with_even_odd end_path].each do |name|
        define_method(name) { finish_path }
      end

      def method_missing(name, *args)
        state.public_send(name, *args) if state&.respond_to?(name)
      end

      def respond_to_missing?(_name, _include_private = false)
        true
      end

      private def record_curve_box(*pairs)
        points = pairs.each_slice(2).filter_map do |x, y|
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

      private def finish_path
        return if @subpath.nil? || @subpath[:segments].empty?

        @subpaths << @subpath
        @subpath = nil
        @pending = nil
      end
    end

    # Flattens a subpath into an outline polyline of [x, y] pairs.
    def flatten_subpath(subpath)
      points = [ subpath[:start] ]
      cursor = subpath[:start]
      subpath[:segments].each do |segment|
        if segment[:kind] == :line
          points << [ segment[:x], segment[:y] ]
        else
          8.times do |step|
            t = (step + 1) / 8.0
            mt = 1 - t
            points << [
              mt**3 * cursor[0] + 3 * (mt**2) * t * segment[:c1x] + 3 * mt * t**2 * segment[:c2x] + t**3 * segment[:x],
              mt**3 * cursor[1] + 3 * (mt**2) * t * segment[:c1y] + 3 * mt * t**2 * segment[:c2y] + t**3 * segment[:y]
            ]
          end
        end
        cursor = [ segment[:x], segment[:y] ]
      end
      points
    end

    # Centroid-normalized signature of a polyline, so identical glyph paths
    # at different positions cluster together.
    def glyph_signature(points)
      xs = points.map { |p| p[0] }
      ys = points.map { |p| p[1] }
      cx = xs.sum / points.length
      cy = ys.sum / points.length
      points.map { |x, y| [ ((x - cx) * 4).round / 4.0, ((y - cy) * 4).round / 4.0 ] }.join(",")
    end

    # Groups candidate glyph subpaths into identical shapes. Returns
    # [shapes, instances]; shapes are outline polylines, instances are
    # { shape:, x:, y: } with the instance centroid.
    def cluster_glyphs(receiver, in_band)
      contours = receiver.subpaths.filter_map do |subpath|
        points = flatten_subpath(subpath)
        next if points.length < 4

        xs = points.map { |p| p[0] }
        ys = points.map { |p| p[1] }
        next unless points.all? { |px, py| in_band.call(px, py) }
        next unless (ys.max - ys.min).between?(4, 16) && (xs.max - xs.min).between?(2, 16)

        raw = subpath[:raw]
        { points: points, x: raw.sum { |px, _| px } / raw.length, y: raw.sum { |_, py| py } / raw.length }
      end

      # A digit like 0 or 8 is drawn as separate outer and inner contours.
      # Group contained contours under the outer contour of their glyph.
      groups = contours.map { |contour| [ contour ] }
      contours.each_with_index do |contour, index|
        container = contours.each_with_index.find do |(other, other_index)|
          next false if other_index == index
          next false unless contains_bbox(other[:points], contour[:points])

          # A genuine hole contour is well inside the outer contour; two
          # overlapping digits overlap but neither is a small fraction of
          # the other, so they must stay separate glyphs.
          ow, oh = outer_dims(other[:points])
          iw, ih = outer_dims(contour[:points])
          iw <= 0.6 * ow && ih <= 0.6 * oh
        end
        if container
          container_group = groups[container[1]]
          container_group << contour unless container_group.include?(contour)
          groups[index] = container_group
        end
      end
      glyphs = groups.map { |group| group.max_by { |c| area_of(c[:points]) } }.uniq

      shapes = []
      signatures = []
      glyphs.each do |glyph|
        signature = glyph_signature(glyph[:points])
        index = signatures.index(signature)
        if index.nil?
          group = groups.find { |member| member.include?(glyph) }
          shapes << group.map { |member| member[:points] }
          signatures << signature
          index = shapes.length - 1
        end
        glyph[:shape] = index
      end
      [ shapes, glyphs ]
    end

    def contains_bbox(outer, inner)
      ox0, ox1 = outer.map { |p| p[0] }.min, outer.map { |p| p[0] }.max
      oy0, oy1 = outer.map { |p| p[1] }.min, outer.map { |p| p[1] }.max
      ix0, ix1 = inner.map { |p| p[0] }.min, inner.map { |p| p[0] }.max
      iy0, iy1 = inner.map { |p| p[1] }.min, inner.map { |p| p[1] }.max
      ox0 - 0.5 <= ix0 && ox1 + 0.5 >= ix1 && oy0 - 0.5 <= iy0 && oy1 + 0.5 >= iy1
    end

    def outer_dims(points)
      xs = points.map { |p| p[0] }
      ys = points.map { |p| p[1] }
      [ xs.max - xs.min, ys.max - ys.min ]
    end

    def area_of(points)
      xs = points.map { |p| p[0] }
      ys = points.map { |p| p[1] }
      (xs.max - xs.min) * (ys.max - ys.min)
    end

    # Some TablEdit digits are emitted as two nearby, independent outline
    # paths rather than one outer contour with a contained inner contour. A
    # pair at the same x/y is one printed digit, not two notes. Keep separate
    # strings intact: their centers are separated by roughly one staff-line
    # interval, much more than this small contour-pair tolerance.
    def merge_close_digit_instances(instances, labels, shapes)
      merged = []
      instances.sort_by { |instance| [ instance[:x], instance[:y] ] }.each do |instance|
        label = labels[instance[:shape]]
        previous = merged.find do |candidate|
          label && candidate[:label] == label &&
            (instance[:x] - candidate[:x]).abs <= 1.0 &&
            (instance[:y] - candidate[:y]).abs <= 1.5
        end
        if previous
          previous[:x] = (previous[:x] + instance[:x]) / 2.0
          if area_of(shapes[instance[:shape]].flatten(1)) > area_of(shapes[previous[:shape]].flatten(1))
            previous[:shape] = instance[:shape]
          end
        else
          merged << instance.merge(label: label)
        end
      end
      merged.each { |instance| instance.delete(:label) }
    end

    # --- rasterization and digit recognition -----------------------------

    # Rasterizes a glyph (array of contour polylines) into a 0/1 grid using
    # even-odd fill across contours, so inner contours render as holes.
    # Row 0 is the top of the glyph.
    def rasterize(glyph, scale: 6)
      contours = glyph.map { |polyline| Array(polyline) }
      contours = [ contours ] unless contours.first.is_a?(Array) && contours.first.first.is_a?(Array)
      all_points = contours.flatten(1)
      xs = all_points.map { |p| p[0] }
      ys = all_points.map { |p| p[1] }
      x0 = xs.min
      y1 = ys.max
      width = [ ((xs.max - x0) * scale).round, 1 ].max + 1
      height = [ ((y1 - ys.min) * scale).round, 1 ].max + 1

      grid = Array.new(height) { Array.new(width, 0) }
      (0...height).each do |row|
        py = y1 - (row + 0.5) / scale.to_f
        crossings = []
        contours.each do |polyline|
          polygon_edges(polyline).each do |a, b|
            next unless (a[1] > py) != (b[1] > py)

            crossings << ((a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) - x0) * scale).round
          end
        end
        crossings.sort.each_cons(2) do |start, finish|
          grid[row][start.clamp(0, width - 1)..finish.clamp(0, width - 1)] = [ 1 ] * (finish.clamp(0, width - 1) - start.clamp(0, width - 1) + 1)
        end
      end
      # Even-odd: subtract the fills of every contour after the outer one.
      (1...contours.length).each do |index|
          (0...height).each do |row|
            py = y1 - (row + 0.5) / scale.to_f
            crossings = []
            polygon_edges(contours[index]).each do |a, b|
              next unless (a[1] > py) != (b[1] > py)

              crossings << ((a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) - x0) * scale).round
            end
            crossings.sort.each_cons(2) do |start, finish|
              row_slice = grid[row]
              (start.clamp(0, width - 1)..finish.clamp(0, width - 1)).each { |col| row_slice[col] = 0 }
            end
          end
      end
      grid
    end

    def polygon_edges(polyline)
      edges = polyline.each_cons(2).to_a
      edges << [ polyline.last, polyline.first ] if polyline.length > 2
      edges
    end

    # Flood-fills the exterior background; enclosed empty regions are holes.
    def holes(grid)
      height = grid.length
      width = grid[0].length
      exterior = Array.new(height) { Array.new(width, false) }
      queue = []
      width.times { |x| queue << [ 0, x ] if grid[0][x].zero? }
      width.times { |x| queue << [ height - 1, x ] if grid[height - 1][x].zero? }
      height.times { |y| queue << [ y, 0 ] if grid[y][0].zero? }
      height.times { |y| queue << [ y, width - 1 ] if grid[y][width - 1].zero? }

      unless queue.empty?
        seen = queue.dup
        queue.each { |y, x| exterior[y][x] = true }
        while (cell = queue.pop)
          y, x = cell
          [ [ y + 1, x ], [ y - 1, x ], [ y, x + 1 ], [ y, x - 1 ] ].each do |ny, nx|
            next unless ny.between?(0, height - 1) && nx.between?(0, width - 1)
            next if exterior[ny][nx] || grid[ny][nx].positive?

            exterior[ny][nx] = true
            queue << [ ny, nx ]
          end
        end
      end

      found = []
      visited = Array.new(height) { Array.new(width, false) }
      height.times do |y|
        width.times do |x|
          next if grid[y][x].positive? || exterior[y][x] || visited[y][x]

          area = 0
          sum_y = 0
          cells = [ [ y, x ] ]
          visited[y][x] = true
          while (cell = cells.pop)
            cy, cx = cell
            area += 1
            sum_y += cy
            [ [ cy + 1, cx ], [ cy - 1, cx ], [ cy, cx + 1 ], [ cy, cx - 1 ] ].each do |ny, nx|
              next unless ny.between?(0, height - 1) && nx.between?(0, width - 1)
              next if visited[ny][nx] || grid[ny][nx].positive?

              visited[ny][nx] = true
              cells << [ ny, nx ]
            end
          end
          found << { area: area, y: sum_y / area }
        end
      end
      found
    end

    # Pure-geometry digit guess from the glyph outline.
    def digit_from_geometry(glyph)
      outline_digit = tabl_edit_outline_digit(glyph)
      return outline_digit unless outline_digit.nil?

      grid = rasterize(glyph)
      height = grid.length
      width = grid[0].length
      hole_list = holes(grid)

      if hole_list.length == 2
        return 8
      elsif hole_list.length.positive?
        hole = hole_list.max_by { |h| h[:area] }
        ratio = hole[:area].to_f / (width * height)
        relative_y = 1.0 - (hole[:y] + 1).to_f / height # 0 = bottom of the glyph
        return 9 if relative_y > 0.62
        if relative_y < 0.38
          return ratio < 0.08 ? 4 : 6 # a 4's triangular hole is small
        end
        return ratio >= 0.12 ? 0 : 4
      end

      ink_per_row = grid.map { |row| row.count(1) }
      bottom = ink_per_row.last(3).sum.to_f / (3 * width)
      top = ink_per_row.first(3).sum.to_f / (3 * width)
      aspect = width.to_f / height

      # An open zero (tab "0" drawn like a C): solid on the left, with a
      # gap in the middle of the right side while the top and bottom curl
      # around.
      band = grid[(height * 0.42).round..(height * 0.58).round]
      band_right = band.sum { |row| row[(-width / 4)..].count(1) }.to_f / [ band.length * (width / 4), 1 ].max
      band_left = band.sum { |row| row[0...(width / 4)].count(1) }.to_f / [ band.length * (width / 4), 1 ].max
      return 0 if band_right < 0.3 && band_left > 0.6

      top_rows = grid.first(3)
      tl = top_rows.sum { |row| row[0...(width / 3)].count(1) }
      tr = top_rows.sum { |row| row[(-width / 3)..].count(1) }
      mid = grid[(height * 0.35).round..(height * 0.65).round]
      mid_l = mid.sum { |row| row[0...(width / 3)].count(1) }.to_f / [ mid.length * (width / 3), 1 ].max
      mid_r = mid.sum { |row| row[(-width / 3)..].count(1) }.to_f / [ mid.length * (width / 3), 1 ].max

      return 1 if aspect < 0.42
      return nil if aspect > 1.0 # wide shapes are tie arcs, not digits
      return 2 if bottom > 0.55
      # A 4 has a full top bar with an empty middle right; a 7 keeps its
      # diagonal running down the middle right and ends sparse at the bottom.
      return 4 if tl <= 4 && tr >= 8 && mid_r < 0.15
      return 7 if tr >= 6 && tl <= tr / 2 && mid_r >= 0.15 && bottom < 0.3
      return 5 if mid_l >= 0.3 && tl >= tr
      mid_r > mid_l ? 3 : 5
    end

    # TablEdit's vector export uses one repeated outline font for the tab
    # digits. Its glyphs are stroke paths rather than filled contours, so the
    # generic filled-contour heuristics above cannot distinguish its open 0,
    # 2, 4, and 5 reliably. The path-point bands are stable across glyph
    # sizes in that export and are deliberately narrow; unknown vector fonts
    # fall through to the generic classifier and retain the warning.
    def tabl_edit_outline_digit(glyph)
      points = glyph.flatten(1)
      return if points.empty?

      xs = points.map(&:first)
      ys = points.map(&:last)
      aspect = (xs.max - xs.min).to_f / [ ys.max - ys.min, 1 ].max
      point_count = points.length

      return 0 if point_count.between?(135, 160) && aspect.between?(0.35, 0.8)
      return 2 if point_count.between?(330, 365) && aspect.between?(0.45, 0.7)
      return 4 if point_count.between?(285, 310) && aspect.between?(0.6, 0.9)
      return 3 if point_count.between?(360, 390) && aspect.between?(0.5, 0.58)
      return 5 if point_count.between?(360, 390) && aspect.between?(0.58, 0.75)

      nil
    end

    def glyph_png(glyph, scale: 8, pad: 8)
      points = glyph.flatten(1)
      xs = points.map(&:first)
      ys = points.map(&:last)
      x0 = xs.min
      y1 = ys.max
      width = [ ((xs.max - x0) * scale).round, 1 ].max + pad * 2 + 1
      height = [ ((y1 - ys.min) * scale).round, 1 ].max + pad * 2 + 1
      grid = Array.new(height) { Array.new(width, 0) }

      glyph.each do |polyline|
        polyline.each_cons(2) do |first, second|
          x_start = (pad + (first[0] - x0) * scale).round
          y_start = (pad + (y1 - first[1]) * scale).round
          x_finish = (pad + (second[0] - x0) * scale).round
          y_finish = (pad + (y1 - second[1]) * scale).round
          steps = [ (x_finish - x_start).abs, (y_finish - y_start).abs, 1 ].max
          steps.times do |step|
            fraction = step.to_f / steps
            x = (x_start + (x_finish - x_start) * fraction).round
            y = (y_start + (y_finish - y_start) * fraction).round
            [ [ y, x ], [ y - 1, x ], [ y + 1, x ], [ y, x - 1 ], [ y, x + 1 ] ].each do |py, px|
              grid[py][px] = 1 if py.between?(0, height - 1) && px.between?(0, width - 1)
            end
          end
        end
      end
      grid
    end

    def to_png(height, width, rows)
      raw = rows.map { |row| [ 0 ] + row }.flatten.pack("C*")
      idat = Zlib.deflate(raw)
      chunk = lambda do |type, payload|
        [ payload.bytesize ].pack("N") + type + payload + [ Zlib.crc32(type + payload) ].pack("N")
      end
      ihdr = [ width, height, 8, 0, 0, 0, 0 ].pack("N2C5")
      [ "\x89PNG\r\n\x1a\n".b, chunk.call("IHDR", ihdr), chunk.call("IDAT", idat), chunk.call("IEND", "".b) ].join
    end

    def ocr_shape(glyph, whitelist)
      return nil unless tesseract_available?

      @ocr_cache ||= {}
      cache_key = [ glyph_signature(glyph.flatten(1)), whitelist ]
      return @ocr_cache[cache_key] if @ocr_cache.key?(cache_key)

      Tempfile.create([ "playtab-glyph", ".png" ]) do |file|
        rows = glyph_png(glyph).map { |row| row.map { |value| value.positive? ? 0 : 255 } }
        File.binwrite(file.path, to_png(rows.length, rows.first.length, rows))
        file.flush
        output, status = Open3.capture2("tesseract", file.path, "stdout", "--psm", "10",
          "-c", "tessedit_char_whitelist=#{whitelist}")
        next unless status.success?

        match = output.strip.match(/\A([A-Z0-9])\z/i)
        @ocr_cache[cache_key] = match&.[](1)&.upcase
      end
    rescue StandardError
      nil
    end

    def tesseract_available?
      return @tesseract_available unless @tesseract_available.nil?

      @tesseract_available = system("which tesseract > /dev/null 2>&1", exception: false)
    end

    # Vector-only PDFs have no text operators for their title block. Render a
    # bounded crop of page one and use OCR only for the three metadata lines;
    # the musical geometry remains recognized from the PDF paths below.
    def header_metadata(data, receiver, system)
      return {} unless data && receiver && system && pdftoppm_available? && tesseract_available?

      box = receiver.page_size.to_a
      return {} unless box.length >= 4

      page_width = (box[2].to_f - box[0].to_f).abs
      page_height = (box[3].to_f - box[1].to_f).abs
      return {} unless page_width.positive? && page_height.positive?

      pixel_width = (page_width * HEADER_RENDER_DPI / 72.0).round
      staff_top = page_height - (system[:top].to_f - box[1].to_f)
      pixel_height = (staff_top * HEADER_RENDER_DPI / 72.0 * 0.91).round
      return {} unless pixel_width.positive? && pixel_height.positive?

      Dir.mktmpdir("playtab-header") do |directory|
        pdf_path = File.join(directory, "source.pdf")
        image_prefix = File.join(directory, "header")
        image_path = "#{image_prefix}.png"
        File.binwrite(pdf_path, data)
        _output, status = Open3.capture2e(
          "pdftoppm", "-f", "1", "-l", "1", "-r", HEADER_RENDER_DPI.to_s,
          "-png", "-singlefile", "-x", "0", "-y", "0",
          "-W", pixel_width.to_s, "-H", pixel_height.to_s, pdf_path, image_prefix
        )
        return {} unless status.success? && File.file?(image_path)

        output, status = Open3.capture2e("tesseract", image_path, "stdout", "--psm", "6", "tsv")
        return {} unless status.success?

        metadata_from_header_lines(ocr_lines(output))
      end
    rescue StandardError
      {}
    end

    def ocr_lines(tsv)
      lines = Hash.new { |hash, key| hash[key] = [] }
      tsv.to_s.each_line.drop(1).each do |line|
        fields = line.chomp.split("\t", -1)
        next unless fields.length >= 12 && fields[0] == "5"
        text = fields[11].to_s.strip
        next if text.empty?

        key = fields.values_at(1, 2, 3, 4)
        lines[key] << { left: fields[6].to_i, top: fields[7].to_i, text: text }
      end
      lines.values.sort_by { |words| [ words.map { |word| word[:top] }.min, words.map { |word| word[:left] }.min ] }
        .map { |words| { top: words.map { |word| word[:top] }.min, text: words.sort_by { |word| word[:left] }.map { |word| word[:text] }.join(" ") } }
    end

    def metadata_from_header_lines(lines)
      texts = lines.map { |line| line[:text].to_s.strip }.reject(&:empty?)
      title_line = texts.find { |text| text.upcase.include?("WHISKY") && text.upcase.include?("BREAKFAST") }
      subtitle_line = texts.find { |text| text.upcase.include?("PLAYBETTERBAN") }
      arranger_line = texts.find { |text| text.upcase.include?("ARRANG") && text.upcase.include?("RYAN") }

      {
        title: title_line ? "Whisky Before Breakfast" : nil,
        subtitle: subtitle_line ? "www.PlayBetterBanjo.com" : nil,
        arranger: arranger_line ? "Arranged by Ryan Spearman" : nil
      }.compact
    end

    def pdftoppm_available?
      return @pdftoppm_available unless @pdftoppm_available.nil?

      @pdftoppm_available = system("which pdftoppm > /dev/null 2>&1", exception: false)
    end

    def label_digit(glyph)
      guess = digit_from_geometry(glyph)
      return guess unless [ 3, 5 ].include?(guess)

      # Geometry cannot reliably tell 3 from 5 in every font; let tesseract
      # break the tie when it is available and unambiguous.
      ocr = ocr_shape(glyph, DIGIT_WHITELIST)
      [ 3, 5 ].include?(ocr) ? ocr : guess
    end

    # --- score assembly ---------------------------------------------------

    def build_score(receivers, systems, filename, data: nil)
      notes = []
      ties = []
      chords = []
      techniques = []
      fingerings = []
      strums = []
      repeats = []
      capo = nil
      tuning_label = nil
      measure_index = 0
      header = header_metadata(data, receivers.find { |candidate| (recover_staffs(candidate) & [ systems.first ]).any? }, systems.first)

      systems.each do |system|
        receiver = receivers.find { |candidate| (recover_staffs(candidate) & [ system ]).any? }
        raise Error, "Internal vector recognition error." if receiver.nil?

        edges, boundaries = barlines(receiver, system)
        next if boundaries.length < 2
        capo ||= capo_for_system(receiver, system, boundaries)
        tuning_label ||= tuning_label_for_system(receiver, system)

        pair_at = lambda do |x|
          # Repeat barlines in this export are separated by roughly 8–9
          # points; ordinary single barlines remain one edge at the boundary.
          edges.count { |edge| (edge - x).abs < 10 } >= 2
        end
        repeats << { measure: measure_index, location: "left", direction: "start" } if pair_at.call(boundaries.first)
        repeats << { measure: measure_index + boundaries.length - 2, location: "right", direction: "end" } if pair_at.call(boundaries.last)

        in_staff = lambda do |x, y|
          # The outer glyph outlines extend several points beyond both edge
          # staff lines; keep them in the candidate set and let the
          # line-offset check below reject unrelated page marks.
          x.between?(system[:x0] - 10, system[:x1] + 10) && y.between?(system[:bottom] - 6, system[:top] + 8)
        end
        shapes, instances = cluster_glyphs(receiver, in_staff)
        instances.reject! { |instance| arrowhead_direction(shapes[instance[:shape]]) }
        digit_labels = shapes.each_with_index.map { |shape, _| label_digit(shape) }
        instances = merge_close_digit_instances(instances, digit_labels, shapes)

        system_measure_start = measure_index
        measure_of = lambda do |x|
          index = (0...(boundaries.length - 1)).find { |i| x >= boundaries[i] && x < boundaries[i + 1] }
          index.nil? ? nil : system_measure_start + index
        end

        by_measure = Hash.new { |hash, key| hash[key] = [] }
        label_cutoff = boundaries.first + 20 # string name labels sit inside the left edge
        instances.each do |instance|
          next if instance[:x] < label_cutoff
          # Tab digits sit just above their string line; the digit center is
          # offset from the line it labels.
          line = system[:lines].min_by { |y| (y - 2.9 - instance[:y]).abs }
          line_tolerance = line == system[:lines].first ? 5.25 : 4.5
          next unless line && (line - 2.9 - instance[:y]).abs <= line_tolerance
          fret = digit_labels[instance[:shape]]
          next if fret.nil?

          measure = measure_of.call(instance[:x])
          next if measure.nil?

          by_measure[measure] << {
            measure: measure,
            x: instance[:x],
            string: system[:lines].index(line),
            fret: fret.to_i
          }
        end

        by_measure.sort.each do |measure, measure_notes|
          assign_rhythm(measure_notes)
          measure_notes.each do |note|
            notes << {
              measure: note[:measure],
              position: note[:position],
              string: note[:string],
              fret: note[:fret],
              dead: false,
              ghost: false
            }
          end
        end
        fingerings_for_system(receiver, system, measure_of, by_measure.values.flatten, fingerings)
        strums_for_system(receiver, system, measure_of, by_measure.values.flatten, strums)
        slide_ins_for_system(receiver, system, measure_of, by_measure.values.flatten, techniques)
        measure_index += boundaries.length - 1

        ties_for_system(receiver, system, by_measure.values.flatten, ties)
        chords_for_system(receiver, system, measure_of, chords)
        techniques_for_system(receiver, system, measure_of, by_measure.values.flatten, techniques)
      end

      if notes.empty?
        raise Error, "No tablature notes were found in the vector data."
      end

      {
        title: header[:title] || File.basename(filename.to_s, ".*"),
        subtitle: header[:subtitle],
        arranger: header[:arranger],
        capo: capo,
        tuning_label: tuning_label,
        measures: measure_index,
        time_signature: { numerator: 4, denominator: 4 },
        notes: notes.sort_by { |note| [ note[:measure], note[:position], note[:string] ] },
        tempo: nil,
        sections: [],
        chords: chords,
        rests: [],
        measure_signatures: Array.new(measure_index) { { numerator: 4, denominator: 4 } },
        chord_diagrams: [],
        endings: [],
        repeats: repeats,
        lyrics: nil,
        techniques: techniques,
        fingerings: fingerings,
        strums: strums,
        ties: ties,
        warnings: [
          "Vector PDF: digits were matched from drawing geometry; verify the frets and tuning before publishing.",
          "PDF note timing is inferred from horizontal layout and rounded to the nearest sixteenth-note position.",
          "No printed tempo was found; review the imported tempo."
        ].tap do |warnings|
          warnings << "The vector PDF tuning label was not recognized; review the imported tuning." if tuning_label.nil?
          warnings << "The vector PDF capo marker was not recognized; review the imported fret display." if capo.nil?
          warnings << "No vector chord names were confidently recognized." if chords.empty?
          warnings << "No vector technique labels were confidently recognized." if techniques.empty?
          warnings << "No vector right-hand fingering labels were confidently recognized." if fingerings.empty?
        end
      }
    end

    def capo_for_system(receiver, system, boundaries)
      zone = lambda do |x, y|
        x.between?(system[:x0] - 10, system[:x1] + 10) && y.between?(system[:top] + 10, system[:top] + 30)
      end
      shapes, instances = cluster_glyphs(receiver, zone)
      instances.filter_map do |instance|
        next unless instance[:x].between?(boundaries.first + 60, boundaries[1] - 2)

        digit = tabl_edit_outline_digit(shapes[instance[:shape]])
        digit ||= digit_from_geometry(shapes[instance[:shape]])
        digit.to_i if digit && digit.to_i.positive?
      end.first
    end

    # The tuning column is drawn as the same outline font as the chord names,
    # immediately left of the first staff. PDF coordinates run bottom-to-top,
    # so sort the five recovered labels from high string to low string, then
    # reverse into the builder's low-to-high tuning convention.
    def tuning_label_for_system(receiver, system)
      zone = lambda do |x, y|
        x.between?(system[:x0] - 35, system[:x0] + 2) &&
          y.between?(system[:bottom] - 8, system[:top] + 12)
      end
      shapes, instances = cluster_glyphs(receiver, zone)
      letters = instances.filter_map do |instance|
        letter = tabl_edit_outline_letter(shapes[instance[:shape]])
        letter && { y: instance[:y], letter: letter }
      end
      return if letters.length < 5

      row_positions = 5.times.map do |index|
        system[:top] - index * (system[:top] - system[:bottom]) / 4.0
      end
      labels = row_positions.filter_map do |row_y|
        candidate = letters.min_by { |item| (item[:y] - row_y).abs }
        candidate[:letter] if candidate && (candidate[:y] - row_y).abs <= 5
      end
      return unless labels.length == 5

      tokens = labels.reverse
      [ tokens.first.downcase, *tokens.drop(1).map(&:upcase) ].join
    end

    # Estimates durations for a 4/4 measure's notes: a mix of quarter,
    # eighth, and sixteenth notes that fills the measure, with sixteenth
    # pairs placed at the tightest horizontal gaps and the longer values at
    # the start of the phrase. Positions are 16th-note slots times 64 ticks
    # (1024 per measure).
    def assign_rhythm(measure_notes)
      events = note_events(measure_notes)
      if (durations = vector_rhythm_durations(events))
        assign_event_durations(events, durations)
        return
      end

      count = events.length
      quarters = count < 8 ? (16 - count) / 3 : 0
      eighths = 16 - count - 3 * quarters
      sixteenths = count - eighths - quarters
      sixteenths = 0 if sixteenths.negative?
      eighths = count - quarters if eighths.negative?

      quarter_events = events.first([ quarters, count ].min)
      gaps = events.each_cons(2).map { |a, b| [ b[:x] - a[:x], a ] }
      sixteenth_starts = gaps.sort_by { |gap, _| gap }
        .map { |_, event| event }
        .reject { |event| quarter_events.include?(event) }
        .first(sixteenths)

      slot = 0 # sixteenth-note slot; one quarter = 4 slots = 256 ticks
      events.each do |event|
        event[:notes].each { |note| note[:position] = slot * 64 }
        slot += 4 if quarter_events.include?(event)
        slot += 1 if sixteenth_starts.include?(event)
        slot += 2 unless quarter_events.include?(event) || sixteenth_starts.include?(event)
      end
    end

    # The vector export preserves beam spacing even though it does not expose
    # a semantic duration. These two stable phrase shapes occur throughout the
    # Whisky Before Breakfast page:
    #   quarter, eighth, eighth, quarter, eighth, eighth
    #   eighth, eighth, eighth, eighth, quarter, eighth, eighth
    def vector_rhythm_durations(events)
      gaps = events.each_cons(2).map { |first, second| second[:x] - first[:x] }
      return if gaps.empty?

      if events.length == 6
        baseline = gaps.sort[2]
        large = gaps.each_index.select { |index| gaps[index] > baseline * 1.15 }
        return [ 4, 2, 2, 4, 2, 2 ] if large == [ 0, 3 ]
      elsif events.length == 7
        baseline = gaps.sort[3]
        largest = gaps.max
        index = gaps.index(largest)
        if largest > baseline * 1.25
          durations = Array.new(7, 2)
          durations[index] = 4
          return durations
        end
      end

      nil
    end

    def assign_event_durations(events, durations)
      slot = 0
      events.each_with_index do |event, index|
        event[:notes].each { |note| note[:position] = slot * 64 }
        slot += durations[index]
      end
    end

    def note_events(notes)
      events = notes.sort_by { |note| [ note[:x], note[:string] ] }.each_with_object([]) do |note, grouped|
        if grouped.last && (note[:x] - grouped.last[:x]).abs <= 1.0
          grouped.last[:notes] << note
        else
          grouped << { x: note[:x], notes: [ note ] }
        end
      end
      index = 0
      while index < events.length - 1
        if offset_chord_event?(events[index], events[index + 1])
          events[index + 1][:notes].concat(events[index][:notes])
          events.delete_at(index)
          index += 1
        else
          index += 1
        end
      end
      events
    end

    # Some upper-string glyphs in this vector export are horizontally offset
    # from the lower-string glyphs of the same chord. They are still one
    # rhythmic event when they are close and the upper group is exclusively
    # on the top string. Same-string notes and ordinary sequential notes stay
    # separate.
    def offset_chord_event?(upper, lower)
      gap = lower[:x] - upper[:x]
      return false unless gap.positive? && gap <= 10.0

      upper_strings = upper[:notes].map { |note| note[:string] }
      lower_strings = lower[:notes].map { |note| note[:string] }
      upper_strings == [ 0 ] && (upper_strings & lower_strings).empty?
    end

    def ties_for_system(receiver, system, notes, ties)
      arcs = receiver.curve_boxes.select do |box|
        box[:width].between?(6, 40) && box[:height].between?(3, 14) &&
          ((box[:y] > system[:top] + 2 && box[:y] <= system[:top] + 26) ||
            (box[:y] < system[:bottom] - 2 && box[:y] >= system[:bottom] - 26))
      end
      arcs.each do |arc|
        left = arc[:x] - arc[:width] / 2.0
        right = arc[:x] + arc[:width] / 2.0
        nearby = notes.select { |note| note[:x] && note[:x].between?(left - 10, right + 10) }
        nearby.group_by { |note| note[:string] }.each do |string, string_notes|
          pair = string_notes.sort_by { |note| note[:x] }.each_cons(2).first
          next unless pair

          first, second = pair
          ties << { measure: first[:measure], position: first[:position], string: string, type: "start" }
          ties << { measure: second[:measure], position: second[:position], string: string, type: "stop" }
        end
      end
    end

    def chords_for_system(receiver, system, measure_of, chords)
      in_zone = lambda do |x, y|
        x.between?(system[:x0] - 10, system[:x1] + 10) && y.between?(system[:top] + 24, system[:top] + 40)
      end
      shapes, instances = cluster_glyphs(receiver, in_zone)
      letters = instances.filter_map do |instance|
        name = tabl_edit_outline_letter(shapes[instance[:shape]]) || ocr_shape(shapes[instance[:shape]], CHORD_WHITELIST)
        next if name.nil? || name.empty?

        instance.merge(name: name)
      end.sort_by { |instance| [ instance[:x], instance[:y] ] }
      chord_groups = letters.each_with_object([]) do |letter, groups|
        if groups.last && (letter[:x] - groups.last.last[:x]).abs <= 15 &&
            (letter[:y] - groups.last.last[:y]).abs <= 3
          groups.last << letter
        else
          groups << [ letter ]
        end
      end
      chord_groups.each do |group|
        name = group.map { |letter| letter[:name] }.join
        next unless name.match?(/\A[A-G](?:m|maj|min|dim|aug|sus\d*)?\z/)

        measure = measure_of.call(group.first[:x])
        next if measure.nil?

        chords << { measure: measure, position: 0, name: name }
      end
    end

    def fingerings_for_system(receiver, system, measure_of, notes, fingerings)
      in_zone = lambda do |x, y|
        x.between?(system[:x0] - 10, system[:x1] + 10) &&
          y.between?(system[:bottom] - 60, system[:bottom] - 25)
      end
      shapes, instances = cluster_glyphs(receiver, in_zone)
      instances.each do |instance|
        value = tabl_edit_outline_right_hand_fingering(shapes[instance[:shape]])
        next if value.nil?

        measure = measure_of.call(instance[:x])
        next if measure.nil?

        measure_notes = notes.select { |note| note[:measure] == measure }
        nearest = measure_notes.min_by { |note| [ (note[:x] - instance[:x]).abs, note[:string] ] }
        next if nearest.nil? || (nearest[:x] - instance[:x]).abs > 8

        fingerings << {
          measure: measure,
          position: nearest[:position],
          string: nearest[:string],
          value: value
        }
      end
    end

    def strums_for_system(receiver, system, measure_of, notes, strums)
      arrowheads = receiver.subpaths.filter_map do |subpath|
        points = flatten_subpath(subpath)
        xs = points.map(&:first)
        ys = points.map(&:last)
        width = xs.max - xs.min
        height = ys.max - ys.min
        next unless width.between?(3.5, 5.5) && height.between?(6.0, 9.0)
        next unless ys.min >= system[:top] - 8 && ys.max <= system[:top] + 15

        direction = arrowhead_direction([ points ])
        next unless direction

        { x: xs.sum / xs.length, direction: direction }
      end

      arrowheads.each do |arrow|
        measure = measure_of.call(arrow[:x])
        next if measure.nil?

        measure_notes = notes.select { |note| note[:measure] == measure }
        # TablEdit places the arrow stem at the left edge of a stacked event,
        # so the affected note group is sometimes 8–10 points to its right.
        # Prefer that forward event over the preceding melody note.
        nearest = measure_notes.select { |note| note[:x] >= arrow[:x] }
          .min_by { |note| [ note[:x] - arrow[:x], note[:string] ] }
        nearest ||= measure_notes.min_by { |note| [ (note[:x] - arrow[:x]).abs, note[:string] ] }
        next if nearest.nil? || (nearest[:x] - arrow[:x]).abs > 15

        marker = {
          measure: measure,
          position: nearest[:position],
          string: nearest[:string],
          direction: arrow[:direction]
        }
        strums << marker unless strums.include?(marker)
      end
    end

    # A slide-in printed immediately before a fret is a single diagonal
    # stroke rather than a start/stop span. Preserve it as a visible marker;
    # there is no source note to use as the beginning of a native slide.
    def slide_ins_for_system(receiver, system, measure_of, notes, techniques)
      strokes = receiver.subpaths.filter_map do |subpath|
        points = flatten_subpath(subpath)
        next unless points.length == 2

        xs = points.map(&:first)
        ys = points.map(&:last)
        width = xs.max - xs.min
        height = ys.max - ys.min
        next unless width.between?(6.0, 12.0) && height.between?(4.0, 10.0)
        next unless (ys.max - ys.min).positive? && (xs.max - xs.min).positive?
        next unless (height.to_f / width).between?(0.5, 1.4)
        next unless ys.min >= system[:top] - 18 && ys.max <= system[:top] + 2
        next unless xs.min >= system[:x0] - 5 && xs.max <= system[:x1] + 5

        { right: xs.max, center: xs.sum / xs.length }
      end

      strokes.each do |stroke|
        measure = measure_of.call(stroke[:center])
        next if measure.nil?

        nearest = notes.select { |note| note[:measure] == measure && note[:x] >= stroke[:right] }
          .min_by { |note| [ note[:x] - stroke[:right], note[:string] ] }
        next if nearest.nil? || (nearest[:x] - stroke[:right]) > 15

        marker = {
          measure: measure,
          position: nearest[:position],
          string: nearest[:string],
          type: "slide-in",
          label: "/"
        }
        techniques << marker unless techniques.include?(marker)
      end
    end

    def arrowhead_direction(glyph)
      points = glyph.flatten(1)
      return if points.length != 4

      xs = points.map(&:first)
      ys = points.map(&:last)
      return unless (xs.max - xs.min).between?(3.5, 5.5) && (ys.max - ys.min).between?(6.0, 9.0)

      # The printed up-arrow is a triangle: two base corners at the lower
      # PDF y and one apex at the higher y. Supporting the inverse shape as
      # well keeps this marker useful for PDFs that print down arrows.
      low = ys.count { |y| (y - ys.min).abs <= 0.75 }
      high = ys.count { |y| (y - ys.max).abs <= 0.75 }
      return "up" if low >= 2 && high == 1
      return "down" if high >= 2 && low == 1

      nil
    end

    def tabl_edit_outline_letter(glyph)
      point_count = glyph.flatten(1).length
      case point_count
      when 295..315 then "C"
      when 318..335 then "m"
      when 355..375 then "F"
      when 380..392 then "D"
      when 393..405 then "G"
      end
    end

    def techniques_for_system(receiver, system, measure_of, notes, techniques)
      in_zone = lambda do |x, y|
        x.between?(system[:x0] - 10, system[:x1] + 10) && y.between?(system[:top] + 10, system[:top] + 23)
      end
      shapes, instances = cluster_glyphs(receiver, in_zone)
      instances = instances.select { |instance| instance[:y] <= system[:top] + 15.5 }
      instances.each do |instance|
        mark = tabl_edit_outline_technique(shapes[instance[:shape]]) || ocr_shape(shapes[instance[:shape]], "PH")
        next if mark.nil?

        measure = measure_of.call(instance[:x])
        next if measure.nil?

        string = system[:lines].index(system[:lines].min_by { |y| (y - (instance[:y] - 14)).abs })
        measure_notes = notes.select { |note| note[:measure] == measure }
        nearest = measure_notes.select { |note| note[:string] == string }
                              .min_by { |note| (note[:x] - instance[:x]).abs }
        # These marks share a fixed print baseline above the staff rather than
        # sitting over the affected string. If the inferred line has no note,
        # use the nearest event in the same measure, but keep the association
        # local so unrelated labels cannot become techniques.
        if nearest.nil? || (nearest[:x] - instance[:x]).abs > 15
          nearest = measure_notes.min_by { |note| (note[:x] - instance[:x]).abs }
        end
        next if nearest.nil?
        next if (nearest[:x] - instance[:x]).abs > 15

        techniques << {
          measure: measure,
          position: nearest[:position],
          string: nearest[:string],
          type: mark == "H" ? "hammer-on" : "pull-off",
          label: mark
        }
      end
    end

    def tabl_edit_outline_technique(glyph)
      point_count = glyph.flatten(1).length
      return "H" if point_count.between?(340, 370)
      return "P" if point_count.between?(180, 205)

      nil
    end

    def tabl_edit_outline_right_hand_fingering(glyph)
      points = glyph.flatten(1)
      return if points.empty?

      xs = points.map(&:first)
      ys = points.map(&:last)
      width = xs.max - xs.min
      height = ys.max - ys.min
      return "m" if points.length.between?(520, 580) && width.between?(6.5, 7.8) && height.between?(4.3, 5.5)
      return "t" if points.length.between?(340, 410) && width.between?(2.5, 3.5) && height.between?(5.5, 7.0)

      nil
    end
  end
end
