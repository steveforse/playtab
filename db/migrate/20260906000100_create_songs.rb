class CreateSongs < ActiveRecord::Migration[8.1]
  def change
    create_table :songs do |t|
      t.string :title, null: false
      t.jsonb :score, null: false
      t.text :source_text
      t.timestamps
    end
  end
end
