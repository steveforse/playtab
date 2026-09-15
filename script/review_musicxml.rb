#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "nokogiri"
require "pathname"

module MusicxmlReview
  MIDI_PITCHES = [
    [ "C", 0 ], [ "C", 1 ], [ "D", 0 ], [ "E", -1 ], [ "E", 0 ], [ "F", 0 ],
    [ "F", 1 ], [ "G", 0 ], [ "A", -1 ], [ "A", 0 ], [ "B", -1 ], [ "B", 0 ]
  ].freeze

  module_function

  def correct(source, review)
    expected_hash = review.fetch("source_sha256")
    raise ArgumentError, "Review does not match this exact source XML" unless Digest::SHA256.hexdigest(source) == expected_hash

    document = Nokogiri::XML(source)
    parts = document.xpath("/score-partwise/part")
    raise ArgumentError, "Review currently requires one part" unless parts.length == 1

    review.fetch("corrections").each do |correction|
      matches = matching_notes(parts.first, correction)
      unless matches.length == 2 && matches.count { |node| node.at_xpath("./notations/technical/fret") } == 1
        raise ArgumentError, "Expected one matching standard note and one matching TAB note"
      end

      matches.each { |node| correct_note(node, correction, document) }
    end
    document.to_xml(encoding: "UTF-8")
  end

  def matching_notes(part, correction)
    divisions = 1
    matches = []
    part.xpath("./measure").each_with_index do |measure, index|
      tick = 0
      previous = 0
      measure.element_children.each do |node|
        case node.name
        when "attributes"
          divisions = node.at_xpath("./divisions")&.text.to_i || divisions
        when "backup", "forward"
          duration = node.at_xpath("./duration")&.text.to_i || 0
          direction = node.name == "backup" ? -1 : 1
          tick += duration * 960 / divisions * direction
        when "note"
          chord = node.at_xpath("./chord")
          onset = chord ? previous : tick
          unless chord
            previous = onset
            duration = node.at_xpath("./duration")&.text.to_i || 0
            tick += duration * 960 / divisions
          end
          next unless index + 1 == correction.fetch("measure") && onset == correction.fetch("tick")

          fret = node.at_xpath("./notations/technical/fret")
          string = node.at_xpath("./notations/technical/string")
          next if fret && (fret.text.to_i != correction.fetch("expected_fret") || string.text.to_i != correction.fetch("string"))

          pitch = node.at_xpath("./pitch")
          next unless pitch

          midi = midi_value(pitch)
          matches << node if midi == correction.fetch("expected_midi")
        end
      end
    end
    matches
  end

  def correct_note(node, correction, document)
    pitch = node.at_xpath("./pitch")
    pitch.children.remove
    step, alter = MIDI_PITCHES.fetch(correction.fetch("midi") % 12)
    pitch.add_child(element(document, "step", step))
    pitch.add_child(element(document, "alter", alter.to_s)) unless alter.zero?
    pitch.add_child(element(document, "octave", (correction.fetch("midi") / 12 - 1).to_s))

    notations = node.at_xpath("./notations") || node.add_child(document.create_element("notations"))
    technical = notations.at_xpath("./technical") || notations.add_child(document.create_element("technical"))
    fret = technical.at_xpath("./fret")
    fret.content = correction.fetch("fret").to_s if fret
    fingering = document.create_element("fingering", "enclosure" => "circle")
    fingering.content = correction.fetch("finger").to_s
    technical.add_child(fingering)
    node.xpath("./notehead").each { |head| head.delete("parentheses") }
  end

  def midi_value(pitch)
    step = pitch.at_xpath("./step")&.text
    alter = pitch.at_xpath("./alter")&.text.to_i || 0
    octave = pitch.at_xpath("./octave")&.text.to_i
    "C D EF G A B".index(step) + alter + 12 * (octave + 1)
  end

  def element(document, name, text)
    node = document.create_element(name)
    node.content = text
    node
  end

  private_class_method :matching_notes, :correct_note, :midi_value, :element

  def run(arguments)
    source_path, review_path, output_path = arguments.map { |path| Pathname(path) }
    abort "Usage: script/review_musicxml.rb INPUT_XML REVIEW_JSON OUTPUT_XML" unless source_path && review_path && output_path
    raise ArgumentError, "Output must not overwrite the unreviewed source" if source_path.expand_path == output_path.expand_path

    corrected = correct(source_path.binread, JSON.parse(review_path.read))
    output_path.binwrite(corrected)
  end
end

# :nocov:
if $PROGRAM_NAME == __FILE__
  MusicxmlReview.run(ARGV)
end
# :nocov:
