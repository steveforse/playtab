require "test_helper"

class PasswordsMailerTest < ActionMailer::TestCase
  test "reset" do
    mail = PasswordsMailer.reset(users(:one))

    assert_equal [ users(:one).email_address ], mail.to
    assert_equal [ "from@example.com" ], mail.from
    assert_equal "Reset your password", mail.subject
    assert_includes mail.body.encoded, "password reset page"
  end
end
